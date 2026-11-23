# Thanksgiving Event 2026 - Progress Log & Plan

Terakhir diperbarui: 23 November 2026, UTC+7.

Dokumen ini mencatat seluruh status implementasi, hasil verifikasi protokol SWF & live AMF, serta penggantian event Halloween ke Thanksgiving 2026 di `nscc-magnetscript`.

---

## 1. Ringkasan Status Saat Ini

| Komponen / Gate | Status | Catatan & Bukti |
|---|---|---|
| Protokol AMF Thanksgiving (SWF Live + Live Server) | **TERVERIFIKASI** | Diekstrak langsung dari SWF live CDN (`Popup_Thanksgiving_2015_Menu.swf`, `thanksgiving_battle.swf`, `Panel_thanksgiving_2015_MinigameCover.swf`, `Popup_Thanksgiving_2015_mini_game.swf`, `code_library.swf`, `data_library_en.swf`) & diuji live pada `amf.ninjasaga.cc`. |
| Konfigurasi `thanksgiving_event_config.json` | **SELESAI & AKTIF** | Berisi 5 enemy ID resmi (`enemy477`-`enemy481`), service status, battle, claim reward, dan mini-game Werewolf. |
| Runner `ns_thanksgiving.js` | **SELESAI & LULUS UJI LIVE** | Mendukung `status`, `battle [max]`, `minigame [max]`, `full [maxBattle] [maxMini]`, `loop [mode]`, sekuensial per akun dengan retry cooldown & `ns_crypto`/`nscrypt` (`getHash`, `br`, `zrb`). |
| Penggantian Event Halloween | **SELESAI** | `ns_event.js` (wrapper ke `ns_thanksgiving.js`), `ns_state.js` (cek status Battle Heart & Werewolf Bullet + material `item923`-`item925`), dan `README.md` telah diganti ke Thanksgiving 2026. |
| Menu `nscc.bat`, `ns_daily.js`, `ns_multi_manager.js` | **SELESAI** | Menu 6 Thanksgiving, opsi Daily 4-6 (`--with-thanksgiving-*`), dan Multi-Account opsi 8-10 (`thanksgiving_*`). |
| Test Suite & Syntax Check | **SELESAI & LULUS** | `npm run thanksgiving:test` (`ns_thanksgiving.test.js OK`), `nscrypt.js --test`, `ns_crypto.js --test`, dan `node -c` semua file terkait lulus. |

---

## 2. Protokol AMF Terverifikasi (Dari Live SWF & Live Server)

1. **Menu Panel**: `Popup_Thanksgiving_2015_Menu.swf` (judul in-game `"Thanksgiving 2026"`) membuka `thanksgiving_battle.swf` dan `Panel_thanksgiving_2015_MinigameCover.swf` -> `Popup_Thanksgiving_2015_mini_game.swf`.
2. **Status Event**:
   - Battle: `Thanksgiving2015.getBattleStatus([sessionKey])` -> mengembalikan `result.remain_heart`, `result.heart_max`, `result.heart_refill_remain`, `z9f`.
   - Mini-game Werewolf: `Thanksgiving2015.getMiniGameStatus([sessionKey])` -> mengembalikan `result.remain_heart` (Bullet), `result.heart_max`, `result.heart_refill_remain`.
3. **Battle & Klaim Reward (2-Step)**:
   - Rotasi 5 Boss:
     - `enemy477` — `Giant Rainbow Turkey` (`item918`, `item925`)
     - `enemy478` — `Monster Pumpkin` (`item919`, `item925`)
     - `enemy479` — `Cranberry Fairy` (`item920`, `item925`)
     - `enemy480` — `Human Face Yam` (`item921`, `item925`)
     - `enemy481` — `Giant Corn Humanoid` (`item922`, `item925`)
   - Step 1: `Thanksgiving2015.startBattle([sessionKey, enemyId, getHash(sessionKey, enemyId)])`
   - Step 2: `ItemDAO.getBossReward([sessionKey, getHash(sessionKey, enemyId + '|0|token,0'), enemyId, 0, ['token', 0], '', '1', startBattleId, '{"battles":[]}', getHash(sessionKey, '1' + startBattleId + '{"battles":[]}'), br(enemyId + '~0~' + startBattleId), zrb(ivg, ivn)])`
   - Reward server teramati: `+30.000 XP`, `+30.000 Gold`, bahan event (`item918`-`item922`), dan `Turkey Coin` (`item925`).
4. **Mini-game Werewolf (2-Step)**:
   - Step 1: `Thanksgiving2015.startMiniGame([sessionKey])`
   - Step 2: `Thanksgiving2015.finishMiniGame([sessionKey, 0, 3, getHash(sessionKey, '03')])` (Stage 1-3 clear, `resultStatus = 0`)
   - Reward mini-game pada cover: `item923` (`Wolf Teeth`), `item924` (`Gunpowder`), tukar skill `skill596` (`Kinjutsu: Gun Blasting`); drop item di `update_inventory.add_item_id` bersifat peluang (RNG).

---

## 3. Log Pengujian & Verifikasi (23 November 2026)

- **Unit Test & Self-Test:**
  - `npm run thanksgiving:test` (`node ns_thanksgiving.test.js`): **LULUS (`ns_thanksgiving.test.js OK`)** — memverifikasi `thanksgiving_event_config.json` (5 enemy ID + service), `parseCliArgs`, `summarizeBattleReward`, `formatTime`, `parseStatus`, decoder AMF0/AMF3, parser HTTP, pembaca `.saz`, dan deteksi crypto.
  - `node nscrypt.js --test`: **SEMUA LULUS**.
  - `node ns_crypto.js --test`: **SEMUA LULUS**.
- **Uji Live dengan Akun `Mrmgnt1` (`00084612` — `Uzumaki Magnet`, Lv 100):**
  - `node ns_state.js`: **BERHASIL** menampilkan `Thanksgiving Battle` & `Thanksgiving Werewolf` beserta material `item923`-`item925`.
  - `node ns_thanksgiving.js full 1 1`: **BERHASIL** menjalankan 1x Battle (`Giant Rainbow Turkey` `enemy477`, reward `item918` + `item925` Turkey Coin + `30.000 XP` + `30.000 Gold`) dan 1x Mini-game Werewolf (`Stage 3 WIN`, Bullet berkurang normal `4/5 -> 3/5`).
  - `node ns_event.js status`: **BERHASIL** menampilkan status Thanksgiving via wrapper `ns_event.js`.
