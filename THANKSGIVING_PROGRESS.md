# Thanksgiving Event 2026 - Progress Log & Plan

Terakhir diperbarui: 23 November 2026, UTC+7.

Dokumen ini mencatat seluruh status implementasi, log pengujian, dan rencana lanjutan untuk Thanksgiving Event 2026 di `nscc-magnetscript`.

---

## 1. Ringkasan Status Saat Ini

| Komponen / Gate | Status | Catatan & Bukti |
|---|---|---|
| Menu `nscc.bat` (Thanksgiving & Capture) | **SELESAI** | Menu 6 (Status, Auto Battle, Auto Mini-game, Full Event), Menu 7 (Live Capture Runtime AIR / Import `.saz`), serta integrasi menu Harian. |
| Flag `ns_daily.js` | **SELESAI** | Tersedia `--with-thanksgiving-battle`, `--with-thanksgiving-minigame`, `--with-thanksgiving-full`. |
| Multi-account `ns_multi_manager.js` | **SELESAI** | Tersedia opsi 8 (Battle), 9 (Mini-game), 10 (Full Event), sekuensial per karakter dengan cooldown akun. |
| Runner dasar `ns_thanksgiving.js` | **SIAP (MENUNGGU PROTOKOL)** | Mendukung `status`, `battle` (rotasi 5 musuh), `minigame` (+ werewolf), `full`, tanpa parallel request dalam akun yang sama. |
| Decoder AMF0/AMF3 & Parser HTTP | **SELESAI & LULUS TEST** | `lib/amf_decoder.js` mendukung AMF0, nested AMF3 (`0x11`), `Transfer-Encoding: chunked`, dan `gzip`/`deflate`/`br`. |
| Importer & Analyzer Fiddler `.saz` | **SELESAI & LULUS TEST** | `lib/saz_reader.js` + `tools/import_thanksgiving_saz.js` membaca ZIP `.saz` tanpa dependency eksternal dan menganalisis pola hash/token (`sha1 + SALT + sessionKey`, `ucDecode`, field respons). |
| Live Capture Runtime AIR | **SELESAI (SIAP DICOBA LIVE)** | `tools/capture_thanksgiving_amf.js` menggantikan CDP port 8088 dengan local HTTPS proxy `127.0.0.1:8888` khusus `amf.ninjasaga.cc` + backup/restore proxy Windows otomatis. |
| `thanksgiving_event_config.json` | **BELUM TERISI (PLACEHOLDER)** | Sengaja dikosongkan; menunggu hasil capture asli (dilarang menebak endpoint). |
| Kompatibilitas Runner Halloween | **AMAN / TIDAK RUSAK** | `ns_halloween.js` dan `ns_event.js` tidak diubah dan lolos `node -c`. |

---

## 2. Masalah Awal yang Ditemukan

1. `tools/capture_thanksgiving_amf.js` sebelumnya memakai Playwright CDP `http://127.0.0.1:8088`, sehingga `logs/thanksgiving_amf_capture.jsonl` kosong (`0 bytes`).
2. `ninja_saga.exe` berjalan di runtime Adobe AIR dan mengirim traffic HTTPS langsung port `443` ke `amf.ninjasaga.cc`, di luar WebView CEF DevTools.
3. File game lokal (`E:\game\Ninja Saga\files\swf` hanya berisi `skills`, dan `ninja_saga_game_decompiled` tidak memiliki modul event Thanksgiving 2026).

---

## 3. Log Pengujian & Verifikasi (23 November 2026)

- **Unit Test & Self-Test:**
  - `npm run thanksgiving:test` (`node ns_thanksgiving.test.js`): **LULUS (`ns_thanksgiving.test.js OK`)** — menguji `parseStatus`, `renderParam`, `isConfigured`, `loadConfig` (5 nama musuh), decoder AMF0 & AMF3, parser HTTP `chunked` + `gzip`, pembaca `.saz` sintetis + deteksi formula `sha1` & `ucEncode`, parser `.jsonl`, dan argumen CLI capture.
  - `node nscrypt.js --test`: **SEMUA LULUS**.
  - `node ns_crypto.js --test`: **SEMUA LULUS**.
- **Syntax Check (`node -c`):**
  - Lulus pada: `lib/amf_decoder.js`, `lib/saz_reader.js`, `tools/import_thanksgiving_saz.js`, `tools/capture_thanksgiving_amf.js`, `ns_thanksgiving.js`, `ns_halloween.js`, `ns_event.js`, `ns_daily.js`, `ns_multi_manager.js`.
- **Uji Login & Runner dengan Akun `Mrmgnt1`:**
  - `nsclient.js` login `Mrmgnt1`: **BERHASIL** (`chars count = 1`, slot 1: `00084612` — `Uzumaki Magnet`, Lv 100).
  - `node ns_thanksgiving.js status` dengan `Mrmgnt1`: **BERHENTI AMAN** di validasi config (`exitCode = 1`, `FATAL Protokol Thanksgiving belum diisi. Jalankan capture lalu isi thanksgiving_event_config.json.`).
  - Catatan: Saat inspeksi awal, terdeteksi `ninja_saga.exe` aktif (PID `16196`), namun belum ada capture transaksi Thanksgiving dari UI game.

---

## 4. Plan Lanjutan (Untuk Besok)

### Tahap 1 — Ambil Capture Traffic AMF Asli
Pilih salah satu metode saat memainkan event Thanksgiving di `ninja_saga.exe` (pakai `Mrmgnt1`):
- **Opsi A (Fiddler Classic `.saz` — paling aman jika AIR menolak cert lokal):**
  1. Buka Fiddler Classic (HTTPS decryption aktif).
  2. Jalankan `ninja_saga.exe`, login, masuk panel **Thanksgiving 2026**:
     - Cek status event (lihat jumlah heart, ammo, kuota werewolf).
     - Lawan 5 musuh masing-masing minimal 1x:
       1. Giant Rainbow Turkey
       2. Monster Pumpkin
       3. Cranberry Fairy
       4. Human Face Yam
       5. Giant Corn Humanoid
     - Jalankan Mini-game minimal 1x.
     - Jalankan Misi Werewolf minimal 1x.
  3. Simpan capture: `File -> Save -> All Sessions...` menjadi `.saz`.
  4. Jalankan decoder:
     ```bat
     node tools\import_thanksgiving_saz.js path\ke\thanksgiving.saz
     ```
- **Opsi B (Live Proxy Lokal dari `nscc.bat`):**
  1. Jalankan `nscc.bat` -> Menu `7` -> Opsi `1` (`node tools\capture_thanksgiving_amf.js`).
  2. Setujui dialog pemasangan Root CA lokal jika muncul.
  3. Restart/buka `ninja_saga.exe` dan lakukan urutan klik event di atas.
  4. Tekan `Q` atau `Enter` di terminal capture untuk menyimpan `logs\thanksgiving_amf_capture.jsonl` dan `logs\thanksgiving_amf_decoded.json`.

### Tahap 2 — Decode Protokol dari `logs/thanksgiving_amf_decoded.json`
Ekstrak fakta dari hasil capture (tanpa menebak):
1. Nama AMF service untuk status, battle, mini-game, dan werewolf (serta claim reward jika terpisah seperti `HalloweenEvent2016.startBattle` + `ItemDAO.getBossReward`).
2. Urutan parameter tiap service.
3. Formula hash/token/sequence (`sha1`, `zra`/`zrb`, `br`, `msk`/`urk`, `ucEncode`, `tokenBoss`/`tokenLog`, dll.).
4. ID asli kelima musuh:
   - Giant Rainbow Turkey
   - Monster Pumpkin
   - Cranberry Fairy
   - Human Face Yam
   - Giant Corn Humanoid
5. Field respons server untuk `heart`, `heartMax`, `ammo`, `kuota/werewolf`, dan `reward` (plus `startBattleId` / `z9f` / `cooldown` jika ada).

### Tahap 3 — Isi Konfigurasi & Sesuaikan Runner
1. Isi `thanksgiving_event_config.json` sesuai hasil decode.
2. Perbarui `ns_thanksgiving.js` jika ada:
   - Langkah 2-step per battle/minigame/werewolf (`start` -> `claim`/`finish`),
   - Perhitungan hash/token/sequence dinamis (`ns_crypto.js` / `nscrypt.js`),
   - Jeda aman, retry cooldown, atau struktur `parseStatus` khusus.
3. Pastikan tetap tidak ada parallel request dalam akun yang sama.
4. Tambah unit test pada `ns_thanksgiving.test.js` untuk format payload & respons Thanksgiving yang sebenarnya.

### Tahap 4 — Verifikasi Akhir
1. Jalankan `npm run thanksgiving:test` dan `node -c` seluruh file terkait.
2. Uji live `node ns_thanksgiving.js status` lalu 1 siklus uji pada `Mrmgnt1`.
3. Pastikan `ns_halloween.js` dan `ns_event.js` tetap berjalan normal tanpa regresi.
