// SPDX-FileCopyrightText: 2026 SQ8BWM
// SPDX-License-Identifier: GPL-3.0-or-later

// TA SAMA łączność z dwóch źródeł naraz.
//
// SKĄD TO SIĘ WZIĘŁO: 2026-10-06 zmierzyliśmy na żywym ruchu, że jedno QSO
// potrafi dojść do mostka TRZEMA drogami — WSJT-X nadaje „QSO Logged" (typ 5)
// i „Logged ADIF" (typ 12) na grupę multicast, a QLog, który też je odbiera,
// przekazuje je dalej własnym protokołem. Klucz deduplikacji zaczyna się od
// nazwy źródła, więc kopia z QLoga miała INNY klucz i łączność poszłaby na
// serwer DWA RAZY.
//
// Odcisk treści jest w obu identyczny (powstaje ze znaku, daty, czasu co do
// sekundy, pasma, emisji i znaku stacji), więc po nim rozpoznajemy kopię.
// Datagramy niżej to prawdziwe bajty z tamtej sesji, wklejone bez zmian.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../src/store.js';
import { QsoPipeline } from '../src/qso-pipeline.js';
import { setLevel } from '../src/log.js';

setLevel('error');

const WSJTX_TYP5 = Buffer.from(
  'adbccbda00000002000000050000000f57534a542d58202d2053513842574d0000000000'
  + '258e88021120f8010000000753503454455354000000044b4f3132000000000000099a00'
  + '00000346543800000000000000000000000000000000000000000000000000258e880210'
  + '4638010000000653513842574d0000000653513842574d000000064b4f31314547000000'
  + '0000000000ffffffff000000000000000000000000', 'hex');

const WSJTX_TYP12 = Buffer.from(
  'adbccbda000000020000000c0000000f57534a542d58202d2053513842574d0000012e0a'
  + '3c616469665f7665723a353e332e312e300a3c70726f6772616d69643a363e57534a542d'
  + '580a3c454f483e0a3c63616c6c3a373e53503454455354203c677269647371756172653a'
  + '343e4b4f3132203c6d6f64653a333e465438203c7273745f73656e743a303e203c727374'
  + '5f726376643a303e203c71736f5f646174653a383e3230323631303036203c74696d655f'
  + '6f6e3a363e303933373030203c71736f5f646174655f6f66663a383e3230323631303036'
  + '203c74696d655f6f66663a363e303933373536203c62616e643a303e203c667265713a38'
  + '3e302e303032343538203c73746174696f6e5f63616c6c7369676e3a363e53513842574d'
  + '203c6d795f677269647371756172653a363e4b4f31314547203c6f70657261746f723a36'
  + '3e53513842574d203c454f523e', 'hex');

const QLOG = Buffer.from(
  '7b226170706964223a22514c6f67222c2264617461223a7b226f7065726174696f6e223a'
  + '22696e73657274222c22726f776964223a35353130342c2274797065223a226164696622'
  + '2c2276616c7565223a223c63616c6c3a373e535034544553543c667265713a383e302e30'
  + '30323435383c6d6f64653a333e4654383c677269647371756172653a343e4b4f31323c64'
  + '7863633a333e3236393c636f756e7472793a363e506f6c616e643c636f6e743a323e4555'
  + '3c63717a3a323e31353c6974757a3a323e32383c7066783a333e5350343c71736c5f7365'
  + '6e743a313e513c6c6f74775f71736c5f73656e743a313e513c74785f7077723a333e3130'
  + '303c615f696e6465783a323e32343c64697374616e63653a31373e3134332e3235353530'
  + '31313134303735383c6571736c5f71736c5f73656e743a313e513c6b5f696e6465783a31'
  + '3e323c6d795f616e74656e6e613a32313e486f72697a6f6e74616c2044656c7461204c6f'
  + '6f703c6d795f636974793a363e4d6f7479637a3c6d795f636f756e7472793a363e506f6c'
  + '616e643c6d795f63715f7a6f6e653a323e31353c6d795f647863633a333e3236393c6d79'
  + '5f677269647371756172653a363e4b4f313145473c6d795f6974755f7a6f6e653a323e32'
  + '383c6d795f6e616d653a31353e4d6172656b204861637a6577736b693c6d795f7269673a'
  + '32303e69436f6d2072696763746c642064756d6d7920323c6f70657261746f723a363e53'
  + '513842574d3c7366693a333e3130303c73746174696f6e5f63616c6c7369676e3a363e53'
  + '513842574d3c71736f5f646174653a383e32303236313030363c74696d655f6f6e3a363e'
  + '3039333730303c71736f5f646174655f6f66663a383e32303236313030363c74696d655f'
  + '6f66663a363e3039333735363c656f723e227d2c226c6f676964223a227b636536396531'
  + '32662d386433652d343533632d613137302d6263653537346265306436377d222c226d73'
  + '6774797065223a2271736f222c2274696d65223a313739313237393437373232377d', 'hex');

const kosze = [];
after(() => kosze.forEach((d) => rmSync(d, { recursive: true, force: true })));

function magazyn() {
  const dir = mkdtempSync(join(tmpdir(), 'rd-dedup-'));
  kosze.push(dir);
  const s = new Store({
    dir: join(dir, 'queue'), failedDir: join(dir, 'failed'), seenFile: join(dir, 'seen.json'),
  });
  s.init();
  return s;
}

function potok(store, przyDodaniu) {
  return new QsoPipeline({
    operations: ['insert'], pin: 'TEST', targets: [],
    onQSO: (item) => { if (store.enqueue(item) && przyDodaniu) przyDodaniu(store); },
  });
}

/** Przepuszcza datagramy przez potok; zwraca ile QSO weszło do kolejki. */
function przezPotok(store, ...datagramy) {
  let dodane = 0;
  const p = potok(store, () => { dodane += 1; });
  for (const d of datagramy) p.handle(d, { address: '127.0.0.1', port: 1 });
  return dodane;
}

describe('jedna łączność, dwa źródła', () => {
  test('WSJT-X i QLog dają JEDNO QSO, nie dwa', () => {
    assert.equal(przezPotok(magazyn(), WSJTX_TYP5, WSJTX_TYP12, QLOG), 1);
  });

  test('kolejność nie ma znaczenia', () => {
    assert.equal(przezPotok(magazyn(), QLOG, WSJTX_TYP5, WSJTX_TYP12), 1);
  });

  test('pominiecie jest policzone, a nie zgubione po cichu', () => {
    const s = magazyn();
    przezPotok(s, WSJTX_TYP5, QLOG);
    assert.equal(s.skipped, 1);
  });

  test('kopia pomijana takze PO wyslaniu pierwszej', () => {
    // Najtrudniejszy przypadek: pierwsza kopia zdążyła opuścić kolejkę, więc
    // nie ma jej wśród oczekujących — rozpoznanie musi działać na obsłużonych.
    const s = magazyn();
    const p = potok(s, (store) => {
      const [czeka] = store.list();
      store.complete(czeka);
    });
    p.handle(WSJTX_TYP5, { address: '127.0.0.1', port: 1 });
    p.handle(QLOG, { address: '127.0.0.1', port: 1 });
    assert.equal(s.sentCount, 1, 'druga droga nie moze wyslac tego samego QSO drugi raz');
  });

  test('po RESTARCIE mostka kopia nadal jest rozpoznawana', () => {
    // Indeks odcisków trzymamy w pamięci, a odtwarzamy z kluczy w seen.json.
    // Bez tej odbudowy wystarczyłby restart, żeby QSO wysłane wczoraj z WSJT-X
    // poszło dziś drugi raz z QLoga — i nikt by nie wiedział dlaczego.
    const dir = mkdtempSync(join(tmpdir(), 'rd-dedup-restart-'));
    kosze.push(dir);
    const sciezki = {
      dir: join(dir, 'queue'), failedDir: join(dir, 'failed'), seenFile: join(dir, 'seen.json'),
    };

    const przed = new Store(sciezki);
    przed.init();
    const p1 = potok(przed, (store) => {
      const [czeka] = store.list();
      store.complete(czeka);
    });
    p1.handle(WSJTX_TYP5, { address: '127.0.0.1', port: 1 });
    przed.close?.();
    assert.equal(przed.sentCount, 1);

    // nowy obiekt = to samo, co ponowne uruchomienie programu
    const po = new Store(sciezki);
    po.init();
    assert.equal(przezPotok(po, QLOG), 0, 'kopia z QLoga ma zostać pominięta po restarcie');
  });

  test('przelogowanie w TYM SAMYM programie nadal dochodzi', () => {
    // DROGA RATUNKOWA z docs/kolejka.md: operator, któremu QSO nie doszło,
    // loguje je u siebie jeszcze raz. Dostaje wtedy nowy identyfikator (tu:
    // kolejny rowid z QLoga), ale odcisk treści ten sam. Gdybyśmy pomijali
    // każdy znany odcisk, ta powtórka przepadłaby — czyli zepsulibyśmy
    // jedyne, co operator może zrobić sam.
    const s = magazyn();
    const znowu = Buffer.from(QLOG.toString('latin1').replace('55104', '55999'), 'latin1');
    assert.equal(przezPotok(s, QLOG, znowu), 2, 'druga próba z tego samego programu ma przejść');
  });

  test('ROZNE lacznosci nadal przechodza obie', () => {
    // Zabezpieczenie przed zbyt chciwą deduplikacją: gdyby odcisk powstawał
    // z czegoś zbyt ogólnego, drugie QSO zostałoby cicho połknięte.
    const s = magazyn();
    const inne = Buffer.from(QLOG.toString('latin1').replace('SP4TEST', 'SP4TEXT'), 'latin1');
    assert.equal(przezPotok(s, QLOG, inne), 2);
  });
});
