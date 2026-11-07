# BOTTLENECK — Autofriend Ninja Saga

> Dokumen ini jujur soal titik yang **paling mungkin membuat proyek gagal**. Dibaca dulu sebelum eksekusi. Setiap item berisi: apa masalahnya, dampak, cara deteksi, dan mitigasi. Nomor dipakai oleh `PLAN.md`.

---

## 0. Ringkasan prioritas (85% risiko ada di 4 item pertama)

| Prioritas | Bottleneck | Dampak | Bisa dimitigasi? |
|---|---|---|---|
| 🔴 #1 | Deteksi IP/device: "sign up dari device & IP berbeda" + Cloudflare | referral tidak dihitung / akun di-ban | sebagian, mahal |
| 🔴 #2 | Emailnator: inbox & deliverability email verifikasi | alur verify mati total | ganti sumber email (domain sendiri) |
| 🟠 #3 | Captcha: 2 titik (register + verify) & variasi tipe, termasuk slider offline yang belum 100% | akun gagal di tengah, biaya naik | 2captcha + solver offline fallback |
| 🟠 #4 | Proxy murah = 1 keluarga IP; proxy mahal = tidak ekonomis | "1000 akun" praktis mustahil murah | budget keputusan |
| 🟡 #5 | Rate limit / velocity server NS | register dibatasi, verify tertunda | cicil harian |
| 🟡 #6 | Leveling 1000 akun & kuota AMF | waktu lama, socket error | batch 20–30, retry |
| 🟡 #7 | ToS/legal & reputasi | ban mrmgnt | stop-gate & pilot kecil |
| 🟢 #8 | Kualitas kode & debugging UI dinamis | lambat develop | modul kecil + mock |

---

## 1. Deteksi IP & perangkat (paling fatal)

**Masalah.** Syarat resmi: "must sign up from a different device and IP than you." Sysadmin NS akan membandingkan IP registrasi dengan IP login `mrmgnt`. Tapi ada turunan yang lebih berat: (a) pola 1000 akun dari rentang IP proxy yang sama = jelas farming, (b) Cloudflare di depan website bisa menandai browser otomasi (fingerprint, headless, TLS) → captcha lebih keras/soft-block, (c) datacenter proxy (OVH/DigitalOcean dll) sering di-block atau dianggap "satu family".

**Dampak.** (i) Referral count tidak bertambah walau akun lvl 20 & verified; (ii) akun baru di-flag atau diban massal; (iii) akun mrmgnt ikut di-ban (paling parah).

**Deteksi dini.** Gate G1–G3 dengan 1 akun. Kalau G3 tidak naik saat level 20 & verified → masalah = IP/device/syarat, bukan kode. **STOP.**

**Mitigasi.**
- Proxy **residential/mobile**, sticky per akun (bukan rotating tiap request), 1 IP = 1 akun.
- Browser nyata (Edge/Chrome) via Playwright, **bukan** HTTP-only, agar fingerprint & TLS wajar.
- Per device: 1 browser context bersih per akun (cookie/localStorage baru), tidak share profile.
- Jangan registrasi dari IP mesin yang juga login mrmgnt; akun mrmgnt login dari IP yang **tidak** pernah dipakai registrasi.
- Jeda manusiawi, volume harian kecil, tidak 24 jam nonstop.

**Sisa risiko.** Tidak ada jaminan 100%. Server bisa juga menganggap proxy residential "datacenter-ish". Karena itu **pilot 20 dulu**, bukan langsung 1000.

---

## 2. Emailnator (inbox & deliverability)

**Masalah.** `emailnator.com/bulk-emails` dipakai sebagai sumber 1000 email. Tiga hal belum terbukti:
1. Apakah email dari domain contoh (`@gmail.com` dsb) benar-benar bisa dibuka inbox-nya di emailnator? Banyak generator semacam itu hanya menyediakan **inbox untuk domain mereka sendiri**.
2. Apakah email dari situs seperti Ninja Saga sampai (banyak layanan blokir domain temp-mail — NS mungkin juga).
3. Apakah ada API stabil untuk polling inbox? Kalau harus scraping UI dengan browser, 1000 inbox = sangat lambat.

**Dampak.** Kalau inbox tidak bisa dibaca program → langkah verify email mustahil otomatis → target akun berhenti di `REGISTERED` dan referral **tidak** dihitung (syarat email verified).

**Deteksi dini.** Uji 1 alamat: kirim email uji dari mesin sendiri ke alamat emailnator, lihat apakah muncul & bisa dibaca via HTTP. Uji juga kirim verifikasi NS asli ke alamat itu dan cek email masuk.

**Mitigasi (rekomendasi).**
- **Prioritas A:** domain sendiri (mis. `ref.mrmgnt.xyz`) + catch-all → semua `nsxxxxxx@ref.mrmgnt.xyz` masuk satu mailbox; baca via IMAP Gmail/Outlook atau Cloudflare Email Worker → JSON. 100% deliverable & program-friendly.
- Prioritas B: temp-mail API lain yang punya API inbox resmi (mis. Mail.tm / Mailsac berbayar).
- Prioritas C: emailnator hanya kalau terbukti inboxnya bisa dibaca program **untuk domainnya sendiri**.

---

## 3. Captcha (2 titik + variasi)

**Masalah.**
- Registrasi NS memakai reCAPTCHA (widget dinamis, sitekey dari server) — perlu sitekey live tiap run.
- Verify email bisa juga ada captcha (`captcha_verify_enabled`).
- Captcha **custom** (slider/drag/rotate/grid) memakai skema seal/unseal (`_cc_seal`/`_cc_unseal`) & endpoint sendiri. NSCC sudah punya solver offline yang **akurat 8/8 pada artefak uji** tapi **baru 1x sukses live** dan sempat ada artefak "rejected" beruntun sebelum itu.
- Captcha salah berulang **mungkin** memicu lock 24 jam (pernah tercatat di `CAPTCHA_OFFLINE_PROGRESS.md` untuk co-op).

**Dampak.** Akun gagal register (username "hangus"?), atau akun regis tapi belum verify → referral tidak dihitung. Biaya 2captcha naik karena dua titik × 1000.

**Deteksi dini.** G1 mengukur: tipe captcha apa yang muncul di register & verify, success rate, waktu.

**Mitigasi.**
- Router captcha: (1) jalur offline (gratis) dulu, (2) 2captcha sebagai fallback (biaya kecil).
- **Jangan retry buta.** Maks 2 percobaan captcha per akun per sesi, lalu tandai `FAILED:captcha` untuk audit.
- Simpan artefak gagal (`logs/captcha_fail/`) → perbaiki solver/bias ke 2captcha.
- Bila captcha ditolak server 2x → hentikan batch & review (bisa jadi lock).

---

## 4. Ekonomi proxy

**Masalah.** 1000 akun butuh **1000 IP berbeda** (idealnya). Proxy residential berbayar per GB mahal; proxy datacenter murah tapi mudah di-flag. Belum ada pool proxy sekarang.

**Dampak.** Kalau budget kecil → pakai proxy murah → deteksi lebih mudah (lihat #1). Kalau budget besar → biaya bisa melebihi nilai hadiah Kunai.

**Deteksi dini.** Gate G4 (5 akun) mengukur success-rate per kualitas proxy. Bandingkan vendor.

**Mitigasi.** Hitung ROI: hadiah Kunai vs biaya (proxy + 2captcha + email + listrik/waktu). Kalau ±1000 akun butuh biaya > nilai hadiah → **stop**. Pilot dulu, hitung sebelum lanjut.

---

## 5. Rate limit / velocity

**Masalah.** Server NS memakai Cloudflare; endpoint register bisa punya limit IP/velocity. AMF punya limit socket. 10 registrasi/jam vs 100/jam: belum diketahui.

**Mitigasi.** Batas konservatif (≤10/jam), perlambat saat 429/403, jeda antar akun di IP yang sama tidak berlaku (1 IP 1 akun). Cicil 100/hari seperti di `plan.txt`.

---

## 6. Leveling 1000 akun

**Masalah.** `ns_level.js` login via AMF dan battle per misi. 1000 akun × mirip 8–20 menit = 8000–20000 menit kerja CPU/network. Paralel 20–30 proses permintaanmu. Shell spawn `curl.exe` per request → banyak proses anak.

**Deteksi dini.** Ukur waktu 1 akun di G2, lalu G4 dengan N paralel: CPU%, error socket rate.

**Mitigasi.**
- Batch 20–30 worker, jeda antar batch.
- Retry sekali per misi; kalau gagal → simpan progress & lanjut akun lain.
- Bila lamanya tidak wajar → jangan naikkan worker; turunkan.

---

## 7. ToS, legal, dan risiko akun utama

**Masalah.** Membuat 1000 akun untuk referral = jelas melanggar ToS NS (multi-akun, referral palsu, otomasi, bypass captcha). Hukumnya? Ini aturan layanan sebuah game; risiko utama = **ban akun mrmgnt**, hilangnya item, dan IP banned.

**Mitigasi.** Pilot kecil, hentikan bila ada tanda flag, **jangan** melibatkan akun berharga sebelum pilot terbukti. Kamu harus konfirmasi risiko ditanggung sendiri (Q6).

---

## 8. Kualitas kode / debugging UI dinamis

**Masalah.** Kode web NS minified/obfuscated dan **berubah** (APP_VERSION = Date.now, selector/logika bisa beda). Endpoint register/verify belum resmi diekstrak; UI browser lebih lambat (startup, render, captcha), dan error UI sulit di-debug.

**Mitigasi.** Modul kecil, logging status, screenshot saat gagal (tanpa password/token), mock test sebelum live, **jangan** hard-code selector tanpa fallback (mis. cari berdasarkan `name="username"` di `#register-form`).

---

## 9. Risiko lain (cadangan)

- **Username collision**: 1000 nama acak bisa bentrok → cek respons server, generate ulang.
- **Email collision**: email bulk bisa dobel → ledger unik.
- **Kode verify kedaluwarsa** saat antre panjang → verify segera setelah register (≤ menit), bukan besok.
- **Captcha offline salah** di tipe slider baru → 2captcha fallback; catat artefak.
- **Referral tidak langsung dihitung** (delay server) → validasi G3 beri jeda, jangan buru-buru menyimpulkan.
- **Data bocor** (password 1000 akun di repo) → `.gitignore`, file di `state/`.

---

## 10. Yang harus kamu putuskan (link ke REQUIREMENT Q1–Q6)

- **Q1 proxy** → #1 & #4
- **Q2 2captcha** → #3
- **Q3 email** → #2
- **Q4 referral endpoint** → validasi G3/G8
- **Q5 pilot dulu** → #1, #5, #7
- **Q6 risiko ToS** → #7

**Rekomendasi teknis dari saya (untuk didiskusikan):** kerjakan **G0–G4 (≤5 akun)** dulu dengan proxy residential & email domain sendiri, ukur semua metrik, lalu hitung ROI dan keputusan lanjut ke 1000. Jangan tulis 1000-batch sebelum G4 lulus.

---

## 11. UPDATE — Riset setelah jawaban Q1–Q6 (7 Nov 2026)

### #2 Emailnator: status berubah dari "belum terbukti" menjadi "terbukti, dengan batas"
Probe live hanya ke API Emailnator (tidak membuat akun Ninja Saga):

| Uji | Hasil |
|---|---|
| `POST /api/generate-email` `{"ids":[3]}` | **Lulus** — API memberi alamat `@gmail.com` (dot-Gmail) |
| `POST /api/generate-email` `{"ids":[8]}` | **Lulus** — API memberi `@googlemail.com` |
| `POST /api/message-list` untuk alamat hasil generate | **Lulus** — inbox dibaca sebagai JSON |
| `GET /api/message/<id>` | **Lulus** — body pesan tersedia bila tidak `locked` |
| Bulk | Endpoint client ditemukan: `POST /api/generate-bulk-email`, `count` sampai 100/request |

**Batas baru:**
- inbox `PUBLIC`, berarti alamat yang diketahui pihak lain bisa dibuka pihak lain;
- pesan yang lebih lama dari 24 jam dikunci/dibersihkan;
- respons inbox menunjukkan batas pesan efektif `message_limit:10`;
- alamat dot-Gmail berasal dari pool publik — collision/reuse dan deteksi anti-abuse tetap risiko nyata;
- belum ada bukti Ninja Saga akan mengirim/ menerima alamat pool itu. Ini tetap hanya bisa dibuktikan oleh **G1b satu akun nyata**.

### #3 2Captcha: rekomendasi anggaran
Dokumentasi lokal menyebut contoh biaya reCAPTCHA `cost: "0.00299"`; dua titik captcha per akun berarti baseline sekitar $0.006/akun. Untuk 1000 akun: kira-kira $6, tambah retry 20–60% → $7–10. Ini **estimasi**, bukan harga kontrak. Harga dashboard 2Captcha adalah sumber final.

**Keputusan rekomendasi:** isi saldo $10 maksimum untuk pilot; jangan langsung deposit besar atau submit batch besar.

### #1/#4 Proxy: blocker terbesar tersisa
Kamu menyetujui proxy bila ada budget maksimum, tapi angka belum ada. Tanpa angka budget dan vendor, desain belum boleh mengunci jumlah akun/IP.

**Minimum pilot yang disarankan:** 5 IP residential/mobile sticky, 1 IP per akun. Jangan pakai IP yang pernah login akun `mrmgnt`.

### #5 Validasi referral
Endpoint validasi belum diketahui. Validasi awal pakai panel Referral UI akun `mrmgnt`, catat angka awal → jalankan satu akun valid → catat angka sesudahnya. Ini satu-satunya bukti G3 yang aman saat ini.

### STOP condition yang direvisi
- Emailnator tidak menerima verifikasi NS dalam 10 menit → hentikan G1b, jangan coba ulang lebih dari 1 akun.
- Captcha server tolak 2x → stop batch.
- Referral count tidak naik setelah akun `VERIFIED+LVL20` dan window tunggu disetujui → stop. Jangan lanjut ke akun ke-2.
- Respons NS 403/429/lock → stop semua worker.

