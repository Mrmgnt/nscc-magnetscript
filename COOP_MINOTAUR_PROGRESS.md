# Auto Co-op Minotaur - Progress Handoff

Terakhir diperbarui: 6 November 2026, UTC+7.

Dokumen ini menjadi sumber konteks utama untuk melanjutkan pekerjaan di chat baru.

## Ringkasan Progress

**Posisi sekarang: captcha dan room flow sebagian besar sudah bekerja. Battle auto-kill belum terbukti.**

| Gate | Status | Bukti |
|---|---|---|
| Parser tiga akun unik | **SELESAI** | Username duplikat digabung menjadi satu identitas. |
| Scheduler round-robin | **SELESAI LOKAL** | Dry-run menghasilkan tiga host bergilir. |
| Sesi browser dan AMF sama | **SELESAI LIVE** | Tiga captcha pernah diterima dalam satu sesi tanpa `session web expired`. |
| Captcha queue tunggal | **SELESAI** | Captcha diproses berurutan, tidak membuka beberapa challenge bersamaan. |
| Rotate captcha | **BERHASIL LIVE** | Beberapa challenge rotate diterima server. |
| Drag-shape captcha | **BERHASIL LIVE** | Beberapa challenge drag diterima server. |
| Slider captcha | **OFFLINE 100% LULUS (8/8), GATE CAPTCHA LIVE LULUS** | Seluruh 8 artefak slider gagal berlabel ground truth lulus uji 0px diff; siap uji live 1 akun setelah unlock. |
| Create/join/ready room | **BERHASIL LIVE** | Tiga akun pernah masuk room dan ready. |
| Battle `start_atb` | **FIX SIAP, BELUM TERBUKTI LIVE** | Join sintetis dihapus; sekarang state `join` hanya membalas `start_atb`. |
| Auto-kill server | **BELUM SELESAI** | Belum ada `battle_win` atau `battle_finish` setelah fix battle. |
| Energy `25/5/5` | **BELUM SELESAI** | Belum ada kemenangan server valid untuk memicu pengurangan energy. |
| Tiga match round-robin | **BELUM SELESAI** | Menunggu satu match valid lebih dulu. |
| Loop penuh/menu 16 | **BELUM DIAKTIFKAN** | Gate satu dan tiga match belum lulus. |

## Target Akhir

1. Tiga akun unik memainkan Minotaur Extreme.
2. Host bergilir round-robin; dua akun lain menjadi joiner.
3. Captcha selesai otomatis dan command tertunda dikirim ulang.
4. Auto-kill hanya dianggap berhasil jika server mengirim `battle_win` atau `battle_finish`.
5. Energy server terbukti berkurang `25/5/5` untuk host/joiner/joiner.
6. Tiga match berturut-turut selesai tanpa timeout atau kemenangan palsu.
7. Loop penuh/menu 16 baru diaktifkan setelah semua gate lulus.

## Kenapa Captcha Sering Gagal?

### Bottleneck utama: deteksi target slider

Rotate dan drag sudah beberapa kali diterima server. Kegagalan berulang paling banyak berasal dari slider.

Slider menampilkan beberapa kotak checker dalam satu background. Piece hanya cocok dengan satu kotak. Detector lama melakukan dua kesalahan:

- memilih objek gelap biasa, seperti gedung atau lantai, bukan kotak checker;
- menemukan kotak checker yang benar, tetapi koordinat berhenti di tengah kotak, bukan batas kirinya.

Server lalu membalas:

```text
Incorrect. Please try again.
```

Ini berarti submit sampai ke server dan sesi web masih valid, tetapi jawaban koordinat salah.

Perbaikan terbaru:

- scan persegi panjang sesuai ukuran opaque piece;
- ukur boundary kiri, kanan, atas, dan bawah;
- buang kandidat dengan boundary lemah;
- bandingkan histogram warna piece dengan area sekitar kandidat;
- refine koordinat ke batas kiri checker;
- simpan semua kandidat dan skor ke artefak diagnostic.

Perbaikan tersebut lolos terhadap seluruh artefak slider gagal yang tersimpan. Namun hasil terbaru belum sempat dibuktikan live karena akun terkena captcha lock.

### Overhaul dan Validasi Offline Captcha (5 November 2026)

- **Total artefak**: 26 artefak ditemukan dan dipasangkan 100% (8 slider, 7 drag_shape, 11 rotate).
- **Dataset ground truth**: 8 artefak slider diberi label manual di `logs/captcha_fail/captcha_labels.json`.
- **Alat review visual offline**:
  - `tools/captcha_gallery.html`: Web gallery lokal dengan canvas overlay, scrubbing, kontrol opacity, dan tombol pemilihan kandidat checker 1-klik.
  - `tools/captcha_review_server.js`: Server HTTP lokal port 3333 (`npm run captcha:review`).
  - `tools/captcha_cli_review.js`: CLI review & selection tool (`npm run captcha:cli`).
  - `tools/captcha_runner.js`: Regression test runner (`npm run captcha:test`).
  - `lib/png_decoder.js`: Native PNG decoder murni Node.js (0 external npm dependencies).
- **Perubahan algoritma slider**:
  - Ambang batas filter boundary dilonggarkan ke `0.40 * strongestBoundary` agar tidak membuang target valid.
  - Penambahan pengukuran kontinuitas tepi (`borderMismatch`) pada 4 sisi piece vs background sekitarnya.
  - Skor komposit terbobot: `Score = borderMismatch + 75 * histScore`.
- **Akurasi Regression Test**: **100.0% (8/8 LULUS)** dengan selisih `0px` pada seluruh sampel.
- **Dokumentasi detail**: lihat `CAPTCHA_OFFLINE_PROGRESS.md`.

### Bottleneck kedua: captcha lock server

Setiap jawaban salah mengurangi jatah percobaan. Retry live berulang untuk mengembangkan detector akhirnya memicu:

```text
Too many failed captchas
```

Pada 5 November 2026:

- `dummymagnet` terkunci sekitar 24 jam;
- `Mrmgnt1` terkunci sekitar 24 jam;
- `Mrmgnt3` terkunci sekitar 24 jam.

Perkiraan unlock: **6 November 2026 sekitar 11:24 UTC+7**.

Saat lock aktif, server tidak mengirim challenge. Retry tidak dapat menguji detector dan hanya membuang waktu.

### Masalah sesi web: sudah diperbaiki

Sebelumnya browser captcha dan AMF/socket melakukan login API terpisah. Akibatnya token dan `PHPSESSID` berbeda, sehingga submit dapat ditolak sebagai sesi web kedaluwarsa.

Flow sekarang:

1. Browser login satu kali.
2. Browser menyimpan cookie web.
3. Response login browser dipakai oleh `nsclient.login()`.
4. AMF/socket dan captcha memakai token/sesi yang sama.

Bukti live: satu run berhasil menyelesaikan tiga captcha berurutan dalam sesi sama. Jadi `session web expired` bukan bottleneck aktif utama sekarang.

### Keterbatasan pengembangan

Server tidak memberi label posisi target yang benar saat challenge dibuat. Ground truth baru diketahui setelah submit diterima atau ditolak. Karena itu pengembangan awal membutuhkan live retry, sedangkan live retry memiliki batas kegagalan dan lock 24 jam.

Solusi yang sudah diterapkan: setiap kegagalan menyimpan background, piece, koordinat, kandidat, skor, screenshot, dan response server. Detector kemudian diuji ulang secara offline memakai artefak tersebut sebelum live retry berikutnya.

## Bukti Live Terbaik

Satu run sebelumnya menghasilkan:

- `dummymagnet`: drag-shape sukses;
- `Mrmgnt3`: slider sukses;
- `Mrmgnt1`: rotate sukses;
- ketiga akun masuk room;
- ketiga akun ready;
- server mengirim `battle_msg` state `join` ke ketiga akun.

Run berhenti pada `battle outcome timeout`. Saat itu script masih mengirim `battleJoin()` sintetis setelah menerima state `join`.

Bug tersebut sudah diperbaiki. Client network asli tidak mengirim join ulang; client hanya masuk battle lalu mengirim `start_atb`.

## Akun Uji Tambahan

`Mrmgnt2` diuji melalui mode satu akun:

- login berhasil;
- karakter terbaca level 60;
- slot 1 dan slot 2 diuji;
- `SystemData.getPvEServerInit` mengembalikan `status=0`;
- server tidak memberi `pvp_server` atau handoff PVE;
- captcha PVE tidak dapat dipicu memakai akun ini.

Kredensial tidak disimpan ke repository. File akun sementara di `%TEMP%` dihapus otomatis.

## Perubahan Kode Utama

### `nsclient.js`

- Menerima payload login web dari browser.
- AMF memakai token dan sesi web yang sama dengan captcha.

### `lib/ns_captcha_solver.js`

- Menangkap response login web.
- Solver rotate, drag-shape, dan slider.
- Slider boundary scan, candidate filter, histogram selection, dan coordinate refinement.
- Menyimpan screenshot dan JSON diagnostic.
- Mendeteksi captcha lock beserta sisa waktu unlock.

### `ns_coop_minotaur.js`

- Login tiga akun dengan sesi browser masing-masing.
- Captcha queue tunggal dan retry command tertunda.
- Scheduler, room flow, battle flow, dan report.
- State `join` sekarang hanya mengirim `start_atb`.
- Mode uji satu akun:

  ```powershell
  node ns_coop_minotaur.js --captcha-test USERNAME --headful
  ```

- Mode captcha test menerima file berisi satu akun. Mode co-op normal tetap mewajibkan tepat tiga akun unik.

### `lib/ns_pve_battle.js`

- State machine battle.
- Penanganan `join`, `start_atb`, command, win, dan finish.

### `README.md`

- Contoh command captcha test.

## Test Lokal

Command berikut sudah lulus:

```powershell
node --check nsclient.js
node --check ns_coop_minotaur.js
node --check lib\ns_captcha_solver.js
node --check lib\ns_pve_battle.js
node lib\ns_captcha_solver.js --selftest
node lib\ns_pve_battle.js --selftest
node ns_coop_minotaur.js --selftest
node ns_coop_minotaur.test.js
```

Test lokal membuktikan syntax, parser, scheduler gate, captcha queue, timeout, loss handling, energy proof guard, dan cleanup. Test lokal belum membuktikan server menerima auto-kill.

## Langkah Lanjut Setelah Unlock

### Gate 1 - Buktikan captcha terbaru

Uji satu akun saja:

```powershell
node ns_coop_minotaur.js --captcha-test Mrmgnt1 --headful
```

Aturan:

- jika server menerima captcha dan room terbentuk, leave otomatis;
- jika server membalas `Incorrect`, hentikan retry;
- analisis artefak terbaru di `logs\captcha_fail\` secara offline;
- jangan retry akun sama berkali-kali.

### Gate 2 - Buktikan satu match

```powershell
$env:NS_COOP_START_HOST='dummymagnet'
$env:NS_COOP_BATTLE_TIMEOUT='60000'
node ns_coop_minotaur.js --auto-kill --max-matches 1 --headful
```

Syarat lulus:

- tiga captcha diterima;
- room ID tersedia;
- tiga akun join dan ready;
- server mengirim `start_atb`;
- server mengirim `battle_win` atau `battle_finish`;
- hadiah/score terlihat;
- energy server berubah tepat `25/5/5`.

### Gate 3 - Buktikan round-robin

```powershell
node ns_coop_minotaur.js --auto-kill --max-matches 3 --headful
```

Syarat lulus:

- tiga match terkonfirmasi server;
- host bergilir ke tiga akun;
- tidak ada timeout;
- tidak ada kemenangan atau pengurangan energy palsu.

### Gate 4 - Aktifkan loop penuh

Menu 16/loop penuh hanya diaktifkan setelah Gate 1-3 lulus.

## Update Aman Gate 1 - 6 November 2026

- Semua test offline lulus, termasuk regression slider **8/8 (100%)**.
- Retry `--captcha-test` dibatasi menjadi satu percobaan untuk mencegah akumulasi kegagalan.
- Gate 1 berhenti sebelum CAPTCHA karena response login web belum tertangkap.
- Tidak ada submit CAPTCHA dan tidak ada artefak `verify_rejected_*` baru.
- Live test dihentikan sampai capture sesi browser diperbaiki secara offline.
## Gate Live Terbaru - 6 November 2026

- **Gate 1 LULUS**: `Mrmgnt1`, challenge `drag_shape`, `verify success`, room `8541` berhasil dibuat dan ditinggalkan otomatis.
- Capture login browser sekarang mendukung payload terenkripsi `_cc_unseal` dan memakai sesi browser yang sama untuk AMF.
- Retry CAPTCHA dibatasi satu percobaan per akun untuk mencegah lock.
- Gate 2 belum dapat dimulai karena hanya dua akun lokal memiliki PVE aktif: `Mrmgnt` dan `Mrmgnt1`.
- `dummymagnet` dan `Mrmgnt3` membalas `401 Invalid credentials` sebelum CAPTCHA.
- `Mrmgnt2` login valid tetapi `SystemData.getPvEServerInit` tetap status `0` / PVE tidak tersedia.
- Dibutuhkan satu akun unik tambahan dengan PVE status `1` untuk membuktikan match tiga pemain.
## Task Belum Selesai

- [x] Buktikan solver CAPTCHA terbaru berhasil live (drag-shape; slider tetap 8/8 offline).
- [ ] Buktikan fix `start_atb` menghasilkan progression battle.
- [ ] Buktikan auto-kill diterima server.
- [ ] Terima `battle_win` atau `battle_finish` dari server.
- [ ] Verifikasi hadiah/score pada akun.
- [ ] Verifikasi energy server berkurang `25/5/5`.
- [ ] Selesaikan tiga match round-robin.
- [ ] Aktifkan loop penuh/menu 16.

## Catatan Keamanan

- Jangan menulis password, token, session key, handoff token, atau cookie ke file progres/log publik.
- `coop_accounts.txt` tetap menjadi sumber kredensial lokal dan tidak boleh dicommit.

## Gate Battle Live - 6 November 2026

- Tiga akun valid: `Mrmgnt3`, `dummymagnet`, dan `Mrmgnt`.
- Tiga CAPTCHA berhasil dan tiga pemain mencapai battle state `join`, `start`, lalu `start_atb`.
- Join/ready flow diperbaiki dengan acknowledgment per socket.
- Urutan battle diperbaiki: `join -> ready`, `start -> start_atb`, `start_atb -> battle_win`.
- Server belum membalas `battle_win` atau `battle_finish`; run berhenti pada `battle outcome timeout`.
- Loop sampai energy habis belum diaktifkan karena kemenangan, reward, dan pengurangan energy belum terkonfirmasi server.
- Satu artefak drag-shape gagal telah diperbaiki offline; regression baru memilih target lingkaran `135,59`.
### Audit battle_win lanjutan - 6 November 2026

- Live flow sudah mencapai `join -> ready -> start -> start_atb` untuk tiga pemain.
- Pengiriman `battle_win` hanya dari host tidak menghasilkan `battle_finish`.
- Implementasi diubah agar setiap socket pemain mengirim `battle_win` satu kali setelah menerima `start_atb`, sesuai model client-side battle yang berjalan pada semua client.
- Perubahan lulus syntax check dan test lokal; menunggu satu validasi live sebelum loop energy dibuka.
### Live dihentikan karena slider baru - 6 November 2026

- Validasi attle_win tiga socket belum tercapai karena CAPTCHA pertama (Mrmgnt3) ditolak.
- Server melaporkan ails_left=34; script berhenti tanpa retry dan akun lain tidak mengirim CAPTCHA.
- Artefak terbaru: $(verify_rejected_1793957288909.json.Name) beserta background, piece, dan screenshot.
- Wajib tambah label/regression slider baru dan perbaiki detector offline sebelum live berikutnya.
### Review offline slider terbaru - 6 November 2026

- Artefak `verify_rejected_1793957288909` diperiksa manual tanpa submit live baru.
- Target benar dilabeli `x=289`: potongan alat musik dan garis lantai cocok dengan kotak kanan; `pattern/checker` nyaris nol.
- Pilihan lama `x=115` merupakan false target dan sudah ditolak server.
- Tahap berikutnya: masukkan sampel ke regression, perbaiki scoring minimal, lalu jalankan seluruh test offline sebelum live.
