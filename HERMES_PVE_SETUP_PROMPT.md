# Prompt Setup & Skill Hermes Khusus PvE Ninja Saga (STB `razops`)

Salin seluruh prompt di dalam blok di bawah ini dan kirim langsung ke `hermes-agent` di STB (`razops`).

---

```text
Tolong bantu setup, pasang skill khusus Hermes, webhook report WhatsApp, dan scheduler otomatis untuk bot PvE Cerberus Ninja Saga (`nscc-magnetscript`) di STB ARM64 ini (`razops`).

Konteks sistem & batasan STB:
- OS/Arch: Armbian / Ubuntu 20.04 (`aarch64` / ARM64), RAM total 924 MB (±204 MB tersedia), Swap 2.5 GB, `/tmp` 463 MB.
- Runtime: Node.js v20.20.2.
- Service aktif yang TIDAK boleh terganggu: `9router`, `hermes-agent`, `whatsapp-bridge`, `hermes-discord-bridge`, `finance-imap-idle`, Cloudflare tunnel.
- Project bot: `nscc-magnetscript` (hanya 1 dependency npm: `playwright-core`, tanpa Playwright browser download; WebSocket sudah pure Node `ns_pve_node_websocket.js`).

Lakukan langkah-langkah berikut secara berurutan dan laporkan hasilnya ke saya:

### 1. Audit Environment STB & Binary Chromium ARM64
1. Pastikan folder project `nscc-magnetscript` sudah ada di STB (jika belum, beri tahu path target yang disarankan, misalnya `/opt/nscc-magnetscript` atau `$HOME/nscc-magnetscript`, dan cek izin foldernya).
2. Pastikan di dalam folder `nscc-magnetscript`:
   - `node -v` berjalan dengan Node 20 (`v20.20.2`).
   - Jalankan `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev` (jangan download browser x86 dari Playwright karena RAM/storage ketat dan arsitektur ARM64).
   - Cek ketersediaan Chromium sistem ARM64 di `/usr/bin/chromium` atau `/usr/bin/chromium-browser` (jika belum ada dan diperlukan untuk login web/CAPTCHA, cek apakah `apt install -y chromium-browser` atau `chromium` tersedia untuk `arm64`, dan set `NS_CHROMIUM_PATH` jika path-nya berbeda).
   - Cek isi file `coop_accounts.txt` sudah terisi akun target (jangan pernah menampilkan password akun di log/output).
3. Verifikasi `node ns_coop_minotaur.js --dry-run --stb --accounts coop_accounts.txt` serta `npm run selftest` & `node ns_coop_minotaur.test.js` lulus semua.

### 2. Konfigurasi Env Webhook Report WhatsApp (`hermes-notify`)
1. Cek port & endpoint lokal `hermes-agent` yang menerima webhook `agent-task-reports` (`/webhooks/agent-task-reports`) beserta secret HMAC `X-Hub-Signature-256` yang dipakai `whatsapp-bridge` di STB ini.
2. Buat file `.env.pve` (permission `chmod 600`) di folder `nscc-magnetscript` berisi:
   - `HERMES_NOTIFY_URL=http://127.0.0.1:<PORT_HERMES_LOKAL>/webhooks/agent-task-reports` (prioritaskan localhost agar tidak tergantung Cloudflare tunnel yang URL-nya bisa berubah)
   - `HERMES_NOTIFY_SECRET=<SECRET_WEBHOOK_HERMES>`
   - `NS_HERMES_NOTIFY=1`
   - `NS_CHROMIUM_PATH=<PATH_CHROMIUM_ARM64>` (jika diperlukan)
3. Uji kirim 1 test report memakai `lib/ns_hermes_notify.js` untuk memastikan pesan masuk ke WhatsApp saya lewat `whatsapp-bridge`.

### 3. Pasang Skill Hermes Khusus (`ninjasaga-pve-cerberus`)
Buatkan skill Hermes baru bernama `ninjasaga-pve-cerberus` di direktori skill `hermes-agent` agar saya bisa menjalankan, menghentikan, memantau log, atau mengecek energy Ninja Saga lewat chat WhatsApp dengan instruksi singkat.
Skill tersebut harus memahami:
- Mode **Quickmatch (18-1)** default:
  `node ns_coop_minotaur.js --stb --half-energy --accounts coop_accounts.txt`
- Mode **Host Room (18-2, Min Lv 80)** opsional:
  `node ns_coop_minotaur.js --host-room --min-level 80 --stb --half-energy --accounts coop_accounts.txt`
- Aturan penting flag di script:
  - `--stb`: otomatis mengaktifkan `--headless`, `--lock`, `--notify`, serta langsung menutup Chromium setelah login web (`releaseIfStb`) agar pemakaian RAM STB tetap hemat (<100–150 MB).
  - `--half-energy`: mengecek energy via AMF ringan SEBELUM membuka Chromium/WebSocket. Jika energy < 50% (`< 50` untuk Emblem / `< 25` untuk Free), script keluar dengan status `SKIP` (exit code 0) tanpa membuka browser dan tanpa spam notifikasi WhatsApp.
  - `--lock`: membuat lockfile PID di `/tmp/ns_pve_cerberus_<username>.lock` agar scheduler tidak menumpuk proses baru jika match masih berlangsung.
- Saat battle berjalan sampai energy habis (atau terkena error fatal), script otomatis mengirim ringkasan via `lib/ns_hermes_notify.js` ke WhatsApp (`Match total`, `Menang/Kalah/Retry`, `Energy awal -> akhir`, `Reward`, `Status akhir`).
- Skill juga harus menyediakan command cepat via WhatsApp:
  - Cek status proses & lockfile saat ini + baris terakhir log di `logs/` & `coop_report.json`
  - Cek sisa energy akun saat ini (dry-run/AMF)
  - Run manual sekarang (Quickmatch atau Host Room) dengan atau tanpa `--half-energy`
  - Stop/kill proses bot jika user minta berhenti.

### 4. Pasang Scheduler Otomatis (Tunggu Minimal Setengah Energy -> Jalan -> Lapor -> Ulang)
1. Buat wrapper script `run_cerberus_stb.sh` di folder `nscc-magnetscript` yang:
   - Memuat `.env.pve`
   - Mengarahkan `TMPDIR` ke folder di storage utama (misalnya `$HOME/.cache/ns_tmp`) hanya jika perlu agar `/tmp` (463 MB) tidak penuh
   - Menjalankan dengan `nice -n 10` (prioritas CPU rendah supaya `9router`, `hermes-agent`, dan `whatsapp-bridge` tetap responsif):
     `nice -n 10 node ns_coop_minotaur.js --stb --half-energy --accounts coop_accounts.txt >> logs/scheduler.log 2>&1`
   - Menambahkan rotasi log sederhana agar `logs/scheduler.log` tidak membengkak melebihi beberapa MB.
2. Pasang scheduler cron / Hermes scheduler setiap **30 menit** (`*/30 * * * *`):
   - Kenapa 30 menit: refill PvE energy Ninja Saga sekitar `10` energy/jam (50% = `50` Emblem atau `25` Free). Jika energy belum mencapai setengah, script cuma cek AMF ~1–2 detik (RAM ~20–30 MB) lalu exit `0` tanpa spam WhatsApp. Begitu mencapai >= 50%, script otomatis masuk battle sampai energy habis, mengirim report ke WhatsApp, lalu menunggu siklus pengisian 50% berikutnya.
3. Jalankan 1 kali dry-run dari wrapper + scheduler dan tampilkan isi skill, `.env.pve` (sensor secret sebagian), `run_cerberus_stb.sh`, jadwal cron aktif, dan tes notifikasi WhatsApp.
```

