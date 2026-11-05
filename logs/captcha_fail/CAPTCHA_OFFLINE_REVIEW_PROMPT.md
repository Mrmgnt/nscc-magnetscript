# Prompt Chat Baru - Rapikan Solver Captcha Offline

Salin seluruh prompt di bawah ke chat baru.

---

Saya ingin melanjutkan perbaikan solver captcha Ninja Saga secara **offline**.

## Workspace

```text
E:\game\Ninja Saga\nscc-magnetscript
```

## File Utama

```text
lib\ns_captcha_solver.js
COOP_MINOTAUR_PROGRESS.md
logs\captcha_fail\
```

## Batasan Penting

- Jangan menjalankan captcha live, create-room live, atau match live terlebih dahulu.
- Akun utama sedang/sempat terkena captcha lock sekitar 24 jam.
- Jangan menghabiskan jatah captcha untuk trial-and-error.
- Jangan membaca, mencetak, menyalin, atau menyimpan password/token/session key/cookie.
- Kerjakan deteksi gambar menggunakan artefak yang sudah ada di `logs\captcha_fail\`.

## Tujuan

Rapikan dan tingkatkan akurasi solver captcha, terutama tipe `slider`, menggunakan seluruh artefak gagal yang tersimpan.

Hasil akhir tahap offline harus mencakup:

1. Inventaris semua artefak captcha berdasarkan tipe:
   - `slider`
   - `drag_shape`
   - `rotate`
2. Pasangkan setiap file JSON dengan:
   - `_background.png`
   - `_piece.png`
   - screenshot hasil, jika tersedia.
3. Buat file label ground truth manual yang mudah diedit, misalnya:

   ```text
   logs\captcha_fail\captcha_labels.json
   ```

4. Untuk slider, label minimal berisi:

   ```json
   {
     "1793852615709": {
       "type": "slider",
       "targetIndex": 2,
       "expectedX": 193,
       "confidence": "high",
       "notes": "Garis lantai dan rak menyambung di checker tengah"
     }
   }
   ```

5. Buat alat review offline yang mudah digunakan. Pilih salah satu:
   - HTML gallery lokal dengan background dan piece berdampingan serta kandidat checker diberi nomor; atau
   - CLI yang menghasilkan contact sheet dan daftar kandidat.
6. Jangan mewajibkan pengguna menghitung koordinat pixel. Pengguna cukup memilih kandidat `1`, `2`, `3`, dan seterusnya.
7. Simpan pilihan pengguna ke JSON atau hasil yang mudah ditempel kembali ke file label.
8. Buat regression test yang menjalankan detector terhadap seluruh artefak berlabel.
9. Test harus gagal bila hasil detector berbeda dari `expectedX` melebihi toleransi yang jelas.
10. Perbaiki `detectSliderTarget()` berdasarkan data berlabel, bukan berdasarkan satu gambar saja.
11. Pastikan perubahan tidak merusak solver rotate dan drag-shape.
12. Jalankan syntax check dan seluruh self-test lokal.
13. Perbarui `COOP_MINOTAUR_PROGRESS.md` dengan:
    - jumlah artefak yang ditemukan;
    - jumlah artefak yang sudah diberi label;
    - akurasi regression test;
    - perubahan algoritma;
    - task yang masih belum selesai.

## Konteks Masalah Slider

Slider memiliki beberapa kotak checker dalam satu background. Hanya satu kotak yang cocok dengan piece.

Kegagalan detector sebelumnya:

- memilih objek gelap biasa seperti gedung/lantai;
- memilih checker yang salah;
- memilih posisi tengah checker, bukan batas kiri;
- histogram area sekitar kadang memberi skor hampir sama pada dua kandidat.

Perbaikan yang sudah ada dalam `detectSliderTarget()`:

- scan area sesuai ukuran opaque piece;
- skor boundary persegi panjang;
- filter kandidat boundary kuat;
- histogram warna area sekitar;
- refinement batas kiri checker;
- diagnostic candidate scores.

Jangan menganggap algoritma sekarang benar. Verifikasi terhadap semua artefak dan label manual.

## Artefak yang Perlu Diprioritaskan

Mulai dari seluruh file:

```text
logs\captcha_fail\verify_rejected_*.json
```

Prioritaskan JSON dengan:

```json
"type": "slider"
```

Beberapa ID yang pernah dianalisis:

```text
1793837343880
1793837430930
1793838403966
1793838738878
1793839415453
1793839882897
1793840024554
1793852615709
```

Jangan percaya koordinat `details.target.x` lama karena sebagian merupakan jawaban yang ditolak server.

## Cara Kerja yang Diinginkan

1. Baca `COOP_MINOTAUR_PROGRESS.md`.
2. Audit struktur `logs\captcha_fail\` tanpa menghapus artefak.
3. Buat inventory terstruktur.
4. Buat alat manual review kandidat.
5. Tampilkan cara menjalankan alat tersebut.
6. Tunggu atau gunakan label manual yang tersedia.
7. Buat regression test dari label.
8. Perbaiki detector berdasarkan seluruh dataset berlabel.
9. Jalankan semua test offline.
10. Perbarui progress handoff.

## Command Validasi Minimum

```powershell
cd "E:\game\Ninja Saga\nscc-magnetscript"
node --check lib\ns_captcha_solver.js
node --check ns_coop_minotaur.js
node lib\ns_captcha_solver.js --selftest
node lib\ns_pve_battle.js --selftest
node ns_coop_minotaur.js --selftest
node ns_coop_minotaur.test.js
```

Tambahkan command regression captcha baru ke daftar tersebut.

## Definisi Selesai Tahap Offline

Tahap offline dianggap selesai hanya jika:

- semua artefak slider valid masuk inventory;
- alat manual review dapat digunakan;
- label tersimpan tanpa menghitung pixel manual;
- detector diuji terhadap semua label;
- hasil test dan akurasi tercatat;
- tidak ada live captcha yang dijalankan;
- `COOP_MINOTAUR_PROGRESS.md` diperbarui.

Setelah tahap offline selesai, jangan langsung menjalankan live test. Laporkan kesiapan, risiko, dan rekomendasi satu akun untuk satu live validation setelah lock server berakhir.

---

## Cara Menggunakan Prompt Ini

1. Buka  workspace `E:\game\Ninja Saga`.
2. Salin bagian prompt di antara garis `---`.
3. Minta untuk membaca file ini bila konteks tambahan dibutuhkan:

   ```text
   nscc-magnetscript\logs\captcha_fail\CAPTCHA_OFFLINE_REVIEW_PROMPT.md
   ```

4. Jangan berikan password akun pada tahap offline.
