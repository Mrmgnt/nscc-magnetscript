# Progress Perbaikan Solver Captcha Offline

Terakhir diperbarui: 5 November 2026, UTC+7.

Dokumen ini mencatat seluruh hasil inventarisasi, pengembangan alat review offline, pelabelan ground truth, peningkatan algoritma deteksi slider, dan regression testing 100% offline tanpa menyentuh live captcha / akun terkunci.

---

## 1. Ringkasan Eksekutif

| Metrik | Hasil | Keterangan |
|---|---|---|
| **Total Artefak Captcha** | **26 artefak** | 8 slider, 7 drag_shape, 11 rotate. |
| **Kelengkapan Pasangan File** | **100% (26/26)** | Setiap JSON memiliki background, piece, dan screenshot hasil. |
| **Ground Truth Labeled** | **8 / 8 slider** | Tersimpan di `logs/captcha_fail/captcha_labels.json`. |
| **Akurasi Regression Test** | **100.0% (8/8 LULUS)** | Seluruh 8 artefak slider terdeteksi dengan selisih `0px` (`Diff: 0px`). |
| **Toleransi Uji** | `Diff <= 3px` | Standar toleransi alignment browser captcha. |
| **Ketergantungan Eksternal** | **0 package baru** | Menggunakan pure Node.js (decoder PNG internal berbasis `zlib`). |
| **Live Captcha / Network Live** | **0 dipanggil** | Sesuai batasan keamanan 24 jam lock server. |

---

## 2. Inventarisasi Seluruh Artefak Captcha

Semua 26 file JSON di `logs/captcha_fail/` berhasil dipasangkan secara lengkap:

### A. Tipe Slider (8 Artefak)

| ID Tantangan | File JSON | Background | Piece | Screenshot Live | Jawaban Gagal Lama | Ground Truth (`expectedX`) |
|---|---|---|---|---|---|---|
| `1793837343880` | `verify_rejected_1793837343880.json` | `..._background.png` | `..._piece.png` | `...1793837343885.png` | `x=297` (meleset 5px) | `x=302` (Candidate #4) |
| `1793837430930` | `verify_rejected_1793837430930.json` | `..._background.png` | `..._piece.png` | `...1793837430935.png` | `x=38` (kandidat decoy) | `x=251` (Candidate #2) |
| `1793838403966` | `verify_rejected_1793838403966.json` | `..._background.png` | `..._piece.png` | `...1793838403972.png` | `x=175` (di luar kotak) | `x=140` (Candidate #3) |
| `1793838738878` | `verify_rejected_1793838738878.json` | `..._background.png` | `..._piece.png` | `...1793838738884.png` | `x=17` (kandidat decoy) | `x=231` (Candidate #3) |
| `1793839415453` | `verify_rejected_1793839415453.json` | `..._background.png` | `..._piece.png` | `...1793839415459.png` | `x=313` (kandidat decoy) | `x=194` (Candidate #1) |
| `1793839882897` | `verify_rejected_1793839882897.json` | `..._background.png` | `..._piece.png` | `...1793839882902.png` | `x=43` (di luar kotak) | `x=102` (Candidate #1) |
| `1793840024554` | `verify_rejected_1793840024554.json` | `..._background.png` | `..._piece.png` | `...1793840024559.png` | `x=95` (di luar kotak) | `x=174` (Candidate #2) |
| `1793852615709` | `verify_rejected_1793852615709.json` | `..._background.png` | `..._piece.png` | `...1793852615716.png` | `x=108` (di luar kotak) | `x=193` (Candidate #3) |

### B. Tipe Drag Shape (7 Artefak)

Semua memiliki pasangan background 380x200, piece 54x54, dan screenshot live:
- `1793836710953` (`verify_rejected_1793836710953`)
- `1793837167002` (`verify_rejected_1793837167002`)
- `1793837701009` (`verify_rejected_1793837701009`)
- `1793837939709` (`verify_rejected_1793837939709`)
- `1793838607338` (`verify_rejected_1793838607338`)
- `1793838873844` (`verify_rejected_1793838873844`)
- `1793839322607` (`verify_rejected_1793839322607`)

### C. Tipe Rotate (11 Artefak)

Semua memiliki pasangan circular background, circular piece, dan screenshot:
- `1793836232148`, `1793836382728`, `1793836947749`, `1793837073399`, `1793837262073`, `1793837540739`, `1793837585303`, `1793837819021`, `1793837872091`, `1793838127739`, `1793838180266`.

---

## 3. Alat Review Offline yang Telah Dibuat

### 1. Interactive HTML Gallery & Reviewer (`tools/captcha_gallery.html`)
- **Tampilan Visual Canvas**: Background ditampilkan dengan kotak kandidat checker bernomor `[#1]`, `[#2]`, `[#3]` dan penanda merah pada jawaban server yang ditolak (`[REJECT: x=...]`).
- **Interactive Scrubber & Overlay**: Slider X dapat digeser secara real-time untuk melihat piece menyatu dengan background.
- **Kontrol Transparansi / Opacity**: Memungkinkan inspeksi visual kontinuitas garis lantai, rak, bayangan, dan dinding.
- **Pilihan Kandidat 1-Klik**: Pengguna cukup menekan tombol `Candidate #1 (x: ...)`, `Candidate #2 (x: ...)`, dsb. Koordinat X dan indeks langsung terisi tanpa perlu menghitung pixel manual.
- **Simpan Langsung ke File**: Tombol "Save to captcha_labels.json" langsung memperbarui file label melalui server lokal, atau tombol "Download JSON" / "Copy JSON".
- **Modal Regression Test**: Menjalankan test offline langsung dari browser dan menampilkan tabel hasil real-time.

### 2. Review Server Lokal (`tools/captcha_review_server.js`)
Server HTTP ringan tanpa external dependencies:
- Melayani antarmuka gallery di `http://127.0.0.1:3333/`.
- Endpoint API:
  - `GET /api/inventory`: Mendapatkan daftar seluruh artefak dan kandidat checker yang dihitung otomatis.
  - `POST /api/save`: Menyimpan payload label langsung ke `logs/captcha_fail/captcha_labels.json`.
  - `GET /api/test`: Menjalankan regression test detector terhadap seluruh artefak berlabel.
  - `GET /images/*`: Menyajikan file gambar background, piece, dan screenshot dari `logs/captcha_fail/`.

Cara menjalankan:
```powershell
node tools/captcha_review_server.js
# atau melalui npm script:
npm run captcha:review
```

### 3. Review & Management CLI Tool (`tools/captcha_cli_review.js`)
Untuk inspeksi dan review langsung lewat terminal:
```powershell
# Melihat tabel inventaris:
node tools/captcha_cli_review.js list

# Melihat detail kandidat checker pada suatu artefak:
node tools/captcha_cli_review.js show 1793852615709

# Memilih kandidat (misal kandidat #3) beserta catatan:
node tools/captcha_cli_review.js select 1793852615709 3 "Garis lantai dan rak menyambung"

# Menjalankan regression test:
node tools/captcha_cli_review.js test
```

### 4. Regression Test Runner (`tools/captcha_runner.js`)
Menjalankan detector terhadap semua label di `captcha_labels.json` dan memverifikasi batas toleransi:
```powershell
node tools/captcha_runner.js
# atau:
npm run captcha:test
```

### 5. Pure JavaScript PNG Decoder (`lib/png_decoder.js`)
Decoder PNG native Node.js (menggunakan modul bawaan `zlib`) yang mendukung format PNG 8-bit RGB dan RGBA tanpa perlu menginstall library berat (`canvas`, `sharp`, `pngjs`). Menguji dan sukses membaca 84 dari 84 file PNG yang ada.

---

## 4. Perbaikan Algoritma `detectSliderTarget()`

### Masalah yang Ditemukan pada Algoritma Lama
1. **Histogram Area Sekitar Menghasilkan Skor Serupa**:
   Pada challenge `1793840024554`, histogram ring 5-pixel di sekitar kotak decoy (`x=37`) menghasilkan nilai `0.101`, sedangkan kotak target asli (`x=174`) menghasilkan `0.153`. Akibatnya detector lama memilih decoy yang salah.
2. **Threshold Boundary Terlalu Ketat (0.65)**:
   Threshold pemfilteran kandidat `0.65 * strongestBoundary` berisiko membuang kotak target valid yang boundary-nya lebih halus dibanding noise/dekorasi lain.
3. **Kurangnya Verifikasi Kontinuitas Tepi (Edge Continuity)**:
   Piece slider dipotong dari scene asli, sehingga pixel tepi terluar piece (atas, bawah, kiri, kanan) harus memiliki kontinuitas warna yang mulus dengan pixel latar belakang tepat di sampingnya.

### Solusi yang Diimplementasikan
1. **Threshold Boundary Adaptif**:
   Diturunkan ke `0.40 * strongestBoundary` agar seluruh checker box potensial masuk ke evaluasi detail.
2. **Pengukuran Border Continuity Mismatch (`borderMismatch`)**:
   Menghitung rata-rata perbedaan absolut antara 1-pixel perimeter terluar piece dengan 1-pixel perimeter latar belakang di keempat sisi (top, bottom, left, right):
   $$\text{borderMismatch} = \frac{1}{3 \times N} \sum_{p \in \text{edges}} | \text{Piece}(p) - \text{Background}(\text{adjacent}) |$$
   Pada kotak target asli, nilai `borderMismatch` terbukti anjlok sangat signifikan (misal: `29.73` vs decoy `89.70+`).
3. **Skor Komposit Terbobot**:
   $$\text{Score} = \text{borderMismatch} + 75 \times \text{histScore}$$
   Memberikan bobot seimbang antara kontinuitas visual tepi dan kecocokan palet warna area sekitar.
4. **Refinement Presisi Batas Kiri**:
   Melakukan scanning mikro $\pm 3\text{px}$ pada tepi vertikal kiri untuk memastikan koordinat menunjuk batas awal checker, bukan area tengah.

---

## 5. Hasil Regression Test Offline

```text
--- Menjalankan Captcha Regression Test Offline ---
Hasil: 8/8 LULUS (100% akurasi, toleransi <= 3px)
----------------------------------------------------
[✓ PASS] ID: 1793837343880 | Exp: 302 | Got: 302 | Diff: 0px | Conf: high
[✓ PASS] ID: 1793837430930 | Exp: 251 | Got: 251 | Diff: 0px | Conf: high
[✓ PASS] ID: 1793838403966 | Exp: 140 | Got: 140 | Diff: 0px | Conf: medium
[✓ PASS] ID: 1793838738878 | Exp: 231 | Got: 231 | Diff: 0px | Conf: high
[✓ PASS] ID: 1793839415453 | Exp: 194 | Got: 194 | Diff: 0px | Conf: medium
[✓ PASS] ID: 1793839882897 | Exp: 102 | Got: 102 | Diff: 0px | Conf: high
[✓ PASS] ID: 1793840024554 | Exp: 174 | Got: 174 | Diff: 0px | Conf: high
[✓ PASS] ID: 1793852615709 | Exp: 193 | Got: 193 | Diff: 0px | Conf: high
----------------------------------------------------
```

### Hasil Self-Test Lengkap Proyek

```powershell
node --check lib\ns_captcha_solver.js
node --check ns_coop_minotaur.js
node lib\ns_captcha_solver.js --selftest
node lib\ns_pve_battle.js --selftest
node ns_coop_minotaur.js --selftest
node ns_coop_minotaur.test.js
node tools\captcha_runner.js
```
Semua command di atas lulus tanpa error (`SEMUA LULUS`, `100% akurasi`).

---

## 6. Rekomendasi Langkah Setelah Lock Server Berakhir

> [!WARNING]
> Akun masih dalam masa lock 24 jam server (perkiraan unlock: **6 November 2026 ~11:24 UTC+7**). Jangan jalankan match live atau batch uji coba sebelum server membuka kunci.

Setelah unlock:
1. **Gate 1 - Validasi 1 Akun Tunggal**:
   Gunakan mode `--captcha-test` pada 1 akun saja (misalnya `Mrmgnt1`):
   ```powershell
   node ns_coop_minotaur.js --captcha-test Mrmgnt1 --headful
   ```
   - Jika challenge slider muncul dan sukses diterima server -> segera tinggalkan room dan simpan status sukses.
   - Jika terjadi penolakan, hentikan langsung (jangan retry berulang) dan periksa file diagnostik baru di `logs/captcha_fail/`.
2. **Gate 2 - Uji 1 Match Co-op Penuh**:
   Setelah Gate 1 terbukti live, lanjutkan ke validasi battle outcome & pengurangan energy `25/5/5`.


## 7. Percobaan Gate 1 - 6 November 2026

- Seluruh syntax check, self-test, dan regression test offline kembali lulus; slider tetap **8/8 (100%)**.
- `playwright-core` dipasang dari dependency yang sudah tercantum di `package.json`.
- Mode `--captcha-test` dibatasi menjadi **satu percobaan penuh**. Event captcha kedua langsung menghentikan test.
- Capture login diperluas agar tidak bergantung pada URL endpoint dan `nsclient.login()` kini dapat memakai payload sesi browser.
- Gate 1 belum mencapai challenge CAPTCHA karena login browser berhenti pada `Response login web tidak tersedia`.
- Tidak ada file `verify_rejected_*` baru, tidak ada jawaban CAPTCHA dikirim, dan jatah gagal CAPTCHA tidak terpakai.
- Percobaan live dihentikan. Langkah berikut: audit response login browser secara lokal tanpa mencetak payload/token, lalu ulang Gate 1 hanya setelah capture sesi terbukti.
## 8. Gate 1 Live Berhasil - 6 November 2026

- Capture response login browser diperbaiki dengan decoding `_cc_unseal`; payload sesi browser dipakai oleh `nsclient.login()`.
- Gate 1 berhasil pada `Mrmgnt1` dengan challenge `drag_shape`.
- Server membalas `verify success`, room `8541` terbentuk, lalu script meninggalkan room otomatis.
- Hanya satu jawaban CAPTCHA dikirim. Tidak terjadi retry atau penolakan.
- Mode Co-op normal dan `--captcha-test` sama-sama dibatasi satu percobaan CAPTCHA per akun.