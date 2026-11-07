# REQUIREMENT — Autofriend Ninja Saga (Referral Farm)

> Dokumen ini melengkapi `PLAN.md`. Isinya prasyarat teknis, akun/aset yang dibutuhkan, batas rate, dan format data yang harus disepakati **sebelum** kode ditulis.

---

## 1. Tujuan & definisi "selesai"

| Level | Definisi selesai |
|---|---|
| Akun referral | `verified email` **dan** `level 20` **dan** muncul sebagai referral valid di akun `mrmgnt`. |
| Target | 1000 akun dicoba; target sukses ≥ 800 (80%) = ±800 referral → Kunai. |
| Hadiah | Kunai di akun `mrmgnt` ditukar hadiah (langkah G8; perlu info cara redeem). |

Bukan tujuan: bot farming game, jual akun, atau aktivitas yang bisa merusak akun pemain lain.

---

## 2. Prasyarat perangkat lunak

| Item | Wajib? | Status sekarang |
|---|---|---|
| Node.js LTS 18+/20+ | Ya | ✅ v24.16.0 terpasang |
| Windows + `curl.exe` (dipakai `nsclient.js`) | Ya | ✅ |
| `nscc-magnetscript` lengkap (`nsclient.js`, `ns_level.js`, `nscrypt.js`, `lib/`) | Ya | ✅ ada |
| `playwright-core` (browser automation) | Ya | ✅ terpasang (`node_modules/playwright-core`) |
| Browser sungguhan (MS Edge/Chrome) yang dikendalikan Playwright | Ya | ❓ perlu dikonfirmasi ada path binary |
| Akses 2Captcha + saldo | Kondisional (lihat keputusan) | ❓ |
| Akses API emailnator (bulk email + inbox) | Ya | ❓ perlu validasi endpoint |
| Pool proxy | Ya | ❓ **belum ada** |
| `.env` / config lokal untuk key & proxy | Ya | Belum dibuat |

---

## 3. Aset akun yang dibutuhkan

### 3.1 Akun pemberi referral
- `mrmgnt` — akun utama (mrmgnt1 = karakter). Jangan pernah dijalankan lewat proxy murah; IP dia harus **bersih/awal** (tidak dipakai akun-akun baru) agar syarat "device & IP berbeda" terpenuhi.
- Referral code: `DV4U5L93` (dari link `https://ninjasaga.cc/?ref=DV4U5L93`).

### 3.2 Akun referrer baru (1000)
- format kredensial mengikuti NSCC: `username:password` (target level 20; slot 1).
- username: pola `ns<random>` (valid huruf/angka, unik global), password: ≥8 char + upper/lower/number (aturan form: `length, upper, lower, number`).
- email: 1 email unik per akun (belum tentu harus real deliverable **kalau** verify memakai kode yang bisa dibaca dari inbox temp-mail).

### 3.3 Output yang harus dihasilkan script
```
state/accounts.friend.txt   → username:password (kompatibel accounts.txt NSCC)
state/accounts.ledger.json  → { username, email, proxyId, status, timestamps, captchaType, referralConfirmed }
state/failed.json           → alasan gagal per akun (untuk audit, tidak di-retry otomatis)
```
File kredensial **tidak** boleh ikut ke git (tambahkan ke `.gitignore` root, bersama `accounts.txt` yang sudah ada).

---

## 4. Kontrak integrasi eksternal

### 4.1 Ninja Saga web
- Registrasi dimulai dari `https://ninjasaga.cc/?ref=DV4U5L93` (wajib agar `REFERRAL_CODE_KEY` terisi di localStorage).
- Form `#register-form` dengan field: `username`, `email`, `password`; password rules: 8+, upper, lower, number.
- Captcha register: `#captcha-register` (reCAPTCHA widget; sitekey dinamis) — ada kemungkinan juga captcha custom.
- Captcha verify: `captcha_verify_enabled` — kemungkinan muncul di modal verifikasi email.
- Login API: `POST https://api.ninjasaga.cc/login` {username,password,type:'web'} (header Origin/Referer wajib — sudah ada di `nsclient.js`).
- Game/AMF: `https://amf.ninjasaga.cc/` — dipakai leveling.

> Endpoint API register/verify/resend **belum** kita ekstrak resmi; rencana awalnya jalankan via UI browser agar tidak salah protokol. Bila nanti perlu cepat/paralel, endpoint di-ekstrak dari network log (Gate tambahan).

### 4.2 Emailnator
- Sumber requirement: `https://www.emailnator.com/bulk-emails` (bulk email).
- Yang harus diotomatisasi: (1) generate email bulk, (2) buka inbox per alamat, (3) parsing kode verifikasi dari body email NS.
- ⚠️ emailnator harus divalidasi: apakah punya API resmi, apakah inbox bisa dibaca **untuk domain contoh** (mis. `@gmail.com`), atau hanya inbox websitenya sendiri. Ini krusial — kalau inbox tidak bisa diakses program, alur mati. Lihat `BOTTLENECK.md` #2.
- Alternatif yang perlu keputusanmu: domain sendiri + catch-all (mis. `*@ref.example.com`) + IMAP/Cloudflare Worker — lebih stabil & deliverable.

### 4.3 2Captcha (kalau dipakai)
- API v2: `POST https://api.2captcha.com/createTask`, `POST .../getTaskResult`, `POST .../getBalance`; poll ≥5 detik sekali; `reportIncorrect` bila token ditolak.
- `clientKey` disimpan di `.env` (`CAPTCHA_2C_KEY`), **bukan** di kode.
- Bila memakai `RecaptchaV2Task` (bukan Proxyless), proxy akun harus sama dengan yang dipakai browser.

### 4.4 Proxy
- Format config: `state/proxies.txt` satu baris per proxy `type://host:port:user:pass` atau `state/proxies.json`.
- Kebutuhan: **sticky per akun** (1 akun = 1 IP selama register+verify), rotasi saat next akun.
- Karena server NS memakai Cloudflare, HTTP/SOCKS5 saja; **tidak** bisa host/port bebas blocked.

---

## 5. Batasan rate & kesantunan (wajib dipatuhi script)

| Resource | Batas yang diusulkan | Alasan |
|---|---|---|
| Registrasi per IP | 1 akun per IP (tidak dipakai ulang untuk akun ke-2 hari itu) | syarat "IP berbeda" |
| Registrasi total/jam | ≤ 10/jam (mulai kecil), maks 100/hari per Gate G6 | anti velocity block |
| Browser paralel | ≤ 2–4 context | RAM/CPU + pola traffic manusiawi |
| Leveling paralel | 20–30 proses (permintaanmu) — uji dulu 5, naik bertahap | rate AMF + load lokal |
| 2captcha | 1 task in-flight/akun | hindari biaya double |
| Kerusakan yang tidak boleh terjadi | tidak pernah menyentuh/mengubah data akun mrmgnt | risiko paling fatal |

---

## 6. Format data & state (kontrak file)

```
accounts.friend.txt  : nsxxxxx:Pass12345
accounts.ledger.json : {
  "nsxxxxx": {
    "email": "...", "proxyId": "px01",
    "status": "VERIFIED",           // PLANNED|REGISTERED|EMAIL_SENT|VERIFIED|LVLING|LVL20|REFERRED|FAILED
    "captcha": { "register": "recaptcha_v2|offline_slider|2c_grid", "verify": "..." },
    "attempts": { "captcha": 1 },
    "ts": { "created": "...", "verified": "...", "level20": "...", "referred": "..." },
    "note": ""
  }, ...
}
```

---

## 7. Keamanan & kerahasiaan
- `.env` berisi `CAPTCHA_2C_KEY`, kredensial proxy, kredensial email → **jangan commit**.
- Jangan print password/captcha token ke console/log; log hanya status & kode alasan.
- Hentikan semua proses jika mendeteksi (a) login mrmgnt gagal berulang, (b) captcha ditolak 2x berturut, (c) respons 403/429 Cloudflare berturut.

---

## 8. Keputusan yang harus kamu jawab (blocker eksekusi)

Isi jawaban di bawah `plan.txt` atau balas chat; saya butuh yang berstatus **BLOCKING**:

| # | Pertanyaan | Kenapa BLOCKING |
|---|---|---|
| Q1 | Apakah kamu **setuju** memakai proxy residential berbayar? Berapa budget maksimal? | tanpa proxy beda-IP, syarat referral tidak terpenuhi → hasil 0 |
| Q2 | Berapa saldo 2Captcha yang kamu siap bayar (mis. $2, $5, $10)? Atau wajib 100% offline? | menentukan desain captcha_router |
| Q3 | Emailnator langsung dipakai apa boleh diganti domain sendiri/catch-all? | menentukan modul inbox & deliverability |
| Q4 | Apakah ada cara resmi cek `referral-count` (endpoint/panel) selain login UI mrmgnt? | validasi G3 & G8 |
| Q5 | Setuju target pilot 5→20→100 dulu, baru 1000? (rekomendasi: ya) | mencegah ban total mrmgnt di awal |
| Q6 | Konfirmasi risiko: ToS NS melarang akun ganda/referral palsu; akun mrmgnt bisa diban. Kamu tanggung sendiri? | izin menulis kode otomasi |

**Status dokumen: menunggu jawaban Q1–Q6. Belum ada kode yang ditulis.**

---

## 9. UPDATE — Jawaban Q1–Q6 + riset lanjutan (7 Nov 2026)

| # | Jawabanmu | Implikasi pada requirement |
|---|---|---|
| Q1 | **Setuju proxy berbayar** asalkan ada **budget maksimal** (angka belum kau beri) | Masih BLOCKING-angka: berapa **budget maksimal total** (proxy + captcha + email)? Tanpa angka, aku hanya bisa siapkan **pilot** dan berhenti sebelum mengeluarkan uang. |
| Q2 | **2captcha belum tahu** → aku riset | Estimasi pilot ~$0.05, 1000 akun ~$7–10 (lihat `PLAN.md` §6.3). Aku tidak akan memakai saldo tanpa kamu isi. |
| Q3 | **Lebih suka emailnator**, **NS wajib `@gmail.com`** | Terbukti: emailnator menghasilkan `@gmail.com` asli, API JSON tanpa login (lihat §6.1 PLAN). **Diterima sebagai sumber email.** |
| Q4 | **Belum tahu** cara cek referral | Jalur: cek UI `mrmgnt` after G1. Tidak ada endpoint publik yang aku temukan. |
| Q5 | **Pilot dulu: ya** | Gate G0→G1a→G1b→G4 → G5→G6→G7→G8 dipertahankan. |
| Q6 | **Risiko ditanggung sendiri: ya** | Ok sebagai konfirmasi risiko, tapi tetap tidak menghapus tanggung jawab operasional (jangan bikin 1000 akun tanpa pilot). |

### 9.1 Kontrak emailnator (terverifikasi live)
```
POST https://www.emailnator.com/api/generate-email
  headers: Content-Type: application/json, Accept: application/json
  body: {"ids":[3]}      // 3 = dotGmail (@gmail.com), 8 = googleMail (@googlemail.com), 1 = partner-domain
  resp: {"status":"success","email":"...@gmail.com","type":"PUBLIC","email_type_id":3}

POST https://www.emailnator.com/api/generate-bulk-email
  body: {"ids":[3],"count":N}   // N ≤ 100 per request

POST https://www.emailnator.com/api/message-list
  body: {"email":"...@gmail.com","limit":20}
  resp: {"status":"success","messages":[{id,from,subject,timestamp,time_ago,locked}],"message_count":N,"message_limit":10}

GET https://www.emailnator.com/api/message/<urlencoded-id>
  resp: {id,from,subject,date,content,attachments,locked:true|false}
```
**Aturan wajib:** inbox dibersihkan setelah 24 jam → verify HARUS selesai < 24 jam setelah register; `message_limit:10` → jangan retry verify berkali-kali sampai inbox penuh; `locked:true` = pesan >24 jam (dianggap gagal).

### 9.2 Klarifikasi syarat email `@gmail.com`
Aku belum memverifikasi (butuh 1 akun nyata) bahwa form NS **menolak** non-gmail. Yang terbukti dari HTML hanya: input `type="email" required`. Karena kamu yakin wajib `@gmail.com`, **asumsi kerja = wajib gmail**, emailnator dotGmail/googleMail = satu-satunya pilihan murah. Bila G1b ternyata menerima non-gmail, alternatif domain sendiri otomatis terbuka.

### 9.3 Pertanyaan tersisa (yang masih BLOCKING sebelum belanja apa pun)
| # | Pertanyaan | Kapan dibutuhkan |
|---|---|---|
| R1 | Angka **budget maksimal** (Rp/$) untuk proxy + captcha + email? | sebelum beli proxy |
| R2 | Vendor proxy yang kamu pilih + format kredensial | sebelum G4 |
| R3 | Saldo 2captcha minimal yang kamu isi (mis. $1, $5, $10) | sebelum G1b |
| R4 | Kamu ingin aku kerjakan **G0 + G1a (aman, tanpa akun NS)** sekarang? | izin kerja |
| R5 | Siapa yang login ke `mrmgnt` untuk cek `referral-count` setelah G1b — kamu atau aku (kamu beri kredensial)? | G3 |

**Status: masih "diskusi". Belum ada akun/perubahan di server NS. G0 menunggu izin R4.**

