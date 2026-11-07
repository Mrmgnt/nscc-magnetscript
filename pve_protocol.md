# PVE Co-op Minotaur — Protocol Reference (reverse-engineered)

> Fase 0 discovery output. Sources: `network_library.swf` + `Panel_PVE_2016.swf`
> decompiled with JPEXS FFDec 20.1.0.

## 1. Transport

Socket.IO **v2** over **Engine.IO v3** (`EIO=3`). The client (`com.pnwrain.flashsocket`)
connects to a PvE server selected from `SystemData.getPvEServerInit().pvp_server[]`.

- Handshake path: `/socket.io/?EIO=3&transport=websocket` (websocket-only works; client
  also supports `polling` then upgrade).
- Default scheme is `https://` (secure), port from `server.port`; the client can fall back
  to `ws_port`, `air_ws_port`, or `tls_host`.
- Engine.IO packet types: `0` open, `1` close, `2` ping, `3` pong, `4` message.
- Socket.IO packet types: `0` CONNECT, `1` DISCONNECT, `2` EVENT, `3` ACK, `4` ERROR.
- EVENT payload: `2["<event>", <object>]` (v2 protocol, no namespace by default).

## 2. AMF bootstrapping (existing nsclient.js)

1. `POST https://api.ninjasaga.cc/login {username,password,type:'web'}` -> `player_id, token, signature, hash_time`.
2. `SystemService.requireLogin` + `SystemService.snsLogin` -> `sessionKey` (`gs_...`).
3. `SystemData.getPvEServerInit(sessionKey, lang)` returns:
   - `handoff_token`  -> `socket.stx()` -> `_ht`
   - `handoff_nonce`  -> `socket.stn()` -> `_nn`
   - `pvp_server`     -> array of `{ip, port, secure, ws_port, air_ws_port, tls_host}`
   - `quest_list`     -> `[{quest_obj:[{quest, level, energy:[create,join], score:[...]}], display_boss:[...], ...}]`
   - `character_energy`, `remain_time`, `pve_status`, `pveServerVersion`
4. `CharacterDAO.applySkillProfile(sessionKey, "pve")` before entering room (best skill set).
5. `PVEService.buyEnergy(sessionKey)` costs `ENERGY_FEE=70` tokens, refills all energy.
6. `CharacterDAO.getCharacterProfileById(sessionKey, charId, true)` for teammates.

Constants (from `PVE.as`): `MAX_ENERGY_FREE=50`, `MAX_ENEGRY_EMBLEM=100`,
`PLAYER_PER_ROOM=3`, `ENERGY_REFILL_TIME=3600s`, `ENERGY_PER_REFILL=10`,
`ENERGY_FEE=70` tokens, `PvpPVMode=3`.

Energy cost per match is **dynamic** from `quest_obj[].energy[0]` (host/create) and
`energy[1]` (join). (Plan assumed host 25 / join 5; actual values come from server.)

## 3. Socket auth / handshake

On socket `CONNECT` (Engine.IO open):
- Client emits `"auth"` with `{ "sessionKey": <sessionKey>, "dv": <deviceInfo> }`
  (NOT encrypted — `_sk` is null until the server replies).
- Server replies with event `"auth"` carrying `{ sn, status }`:
  - `status == 1` => logged in.
  - `sn` is used to derive the command encryption key.
- Server may also send `"handoff"` -> `{ token }` (sets `_ht`).

### Command encryption key `_sk`

```
_ht = handoff_token, _nn = handoff_nonce  (from getPvEServerInit)
pkr():
  x = pk1(_ht, _nn)            // xor + rol2 + i*5
  x = uiScale(x, _nn)          // reverse, add + rol3 chain
  x = emuMix(x, _nn)           // xor + ror1 chain
  return pk2(x)                // hex
_sk = Yeast.spin(pkr(), sn)    // 4 x int32 state array
```

`Yeast.spin(a, b)`:
```
state = [668265263, -1028477387, -2048144789, -1640531535]
for ch in a:    pace(state, ch)
pace(state, 90)
for ch in slotTag(): pace(state, ch)          // slotTag = "Qm7Kx2Lp9Vd4Rt8Zw"
for ch in b:    pace(state, ch)
for ch in emuTheme(): pace(state, ch)          // emuTheme = "hN3cY6gB1sJ5fT0uE"
for 8: uiNudge(state)
```
`pace(s, ch)`: `s[0]+=pollTick(ch+1,-1028477387); s[3]^=ch; uiNudge(s)`

`uiNudge(s)` (xorshift-32x4):
```
p0=p0+p1; p3=(p3^p0) rotl16; p2=p2+p3; p1^=p2; p1=rotl12;
p0=p0+pollTick(p1,-1640531535); p3=(p3^p0) rotl8; p2=p2+pollTick(p3,-2048144789);
p1^=p2; p1=rotl7;
```
`pollTick(a,b) = maskStep(a,b) = Math.imul(a & 0xFFFF, b) + ((Math.imul(a>>>16, b) & 0xFFFF) << 16) | 0`

### Command encoding (after auth)

Every subsequent emit wraps the payload as:
```
{ "_z": frame(utf8Bytes(json), _sk, ++seq) }
```
`LoaderQueue.frame(data, key, seq)`:
```
k = [key[0]^seq, key[1]+pollTick(seq,-1640531535), key[2]^(rotl(seq,13)), key[3]+seq]
for 6: uiNudge(k)
h = slotCode(seq ^ rotl(key[0],7))         // 8-hex lowercase
for each byte b in data:
   c = b ^ (k[0] ^ (k[2]>>>11) ^ rotl(k[3],5)) & 0xFF
   h += hex(c)
   k[1] ^= pollTick(b+257, -2048144789)
   uiNudge(k)
k[1] ^= data.length
for 4: uiNudge(k)
return h + slotCode(k[0] ^ k[2])           // 8-hex lowercase
```
`slotCode(n) = uint(n).toString(16) padded to 8`.

Note: `deviceInfo()` adds `dv` to every `em()` payload (a device fingerprint object);
the bot can send a minimal static `dv` since the server does not appear to strictly
validate it (same as the login payload which includes `dv`).

## 4. Commands (client -> server)

All via `em(event, payload)` (encrypted after auth):

| Event | Payload | Meaning |
|---|---|---|
| `auth` | `{sessionKey, dv}` | login (plain) |
| `join_room` | `{password, mode, quest, ver}` | create room (no room_name) |
| `join_room` | `{room_name, password, ver}` | join existing room |
| `join_room` | `{room_name:"lobby"}` | back to lobby |
| `ready` | `{character_id}` | mark ready |
| `ready` | `{data:{}}` | host start (via `startGame()`) |
| `ready` | `{character_id, ta, tb}` | set team + ready |
| `cancel_ready` | `{character_id}` | cancel ready |
| `start_set_team` | `{}` | request team setup |
| `updateTeam` | `{ta, tb}` | confirm team post |
| `get_room_summary` | `{}` | list rooms |
| `leave_room` | `{room:<id>}` (string) | leave room |
| `kick_user` | `{character_id}` | kick |
| `battle_msg` | `{message:{state,...}}` | battle command |
| `room_chat_message` / `lobby_chat_message` / `private_room_message` | `{message}` | chat |

### Battle messages (`battle_msg` -> `message`)

`message.state` values seen:
- `"join"`   `{charId, charName, charAgility, charType:"player", side:1}`
- `"init"`   (after DB chars loaded: `sendData({event:"info", state:"init"})`)
- `"ready"`  (after load battle complete)
- `"battle_command"` `{charId, battleAction:{action, skillId|item}}`
  - action in: `skill`, `bloodline`, `senjutsu`, `item`, `charge`, `pass`, `dodge`, `weapon_attack`
- `"battle_win"` (only accepted with `KEY_BATTLE_WIN = "BATTLE_HAV_WIN"` marker)

## 5. Events (server -> client)

| Event | Data | Meaning |
|---|---|---|
| `auth` | `{sn, status}` | login result + key material |
| `handoff` | `{token}` | handoff token |
| `version_error` | - | stale client |
| `join_room` | `{...}` | room join result |
| `force_lobby` | `{...}` | kicked back to lobby |
| `ready` | `{...}` (array of char ids) | someone readied |
| `cancel_ready` | `{...}` | ready cancelled |
| `kick_user` | `{...}` | you were kicked |
| `leave_room` | `{...}` | a player left |
| `updateTeam` | `{...}` | team updated |
| `start_set_team` | `{...}` | host wants team setup |
| `reset_ready` | - | reset ready flags |
| `get_room_summary` | `{room_array:[...]}` | room list |
| `destroy_battle` | - | battle destroyed |
| `captcha_required` | - | client shows web captcha (`postMessage {action:'show_captcha', ctx:'pve'}`) |
| `online_count` / `count` | `{count}` | online count |
| `admin_message` / `admin_message_timer` | `{message}` | server notice |
| `lobby_chat_message` / `room_chat_message` / `private_room_message` | `{message,...}` | chat |
| `battle_msg` | `{message}` | battle data (info/join, start, start_atb, battle_action, battle_win, ...) |
| `battle_start` | (see below) | battle begins |

### Battle data flow (from `Client.as`)

- Server -> `info`/`join`: `{ta:[charIds], tb:[enemyIds], watchers, mode, stage, tournament}`
  - `tb` for PVE contains `ene_<id>` strings; client maps to enemy data + builds limbs.
- Server -> `info`/`ready` (per player ready), `info`/`init` (start battle), `info`/`start`.
- `start_atb` -> client `BattleProcessor.init()`, then sends action turns.
- `battle_action` -> `Central.battle.callBattleAction` (execute a turn).
- `battle_win` -> `Central.battle.callBattleFinishHAV`.

## 6. Battle authority & AUTO-KILL

Temuan kunci dari decompile (Battle.as / BattleProcessor.as / Client.as):

- **Damage & HP dihitung di klien.** `BattleProcessor.setCharacterCommand` -> `finalizeBattleAction`
  -> `processBattleAction` menghasilkan `battleAction` (dmgArr, defenderDamageHp, dodge, buff...).
  Server PVE co-op hanya **relay** `battle_action` ke client lain; tidak menghitung ulang damage.
- **Kondisi menang PVE** = semua musuh (side 2) HP <= 0 (`isBattleWin`). Client lalu kirim
  `{event:"info", charId, state:"battle_win"}` dengan key gate `BATTLE_HAV_WIN`.
- **Reward & score final dihitung SERVER** dan datang di `battle_finish` sebagai
  `{reward:{<charId>:[...]}, score:{<charId>:N}, winnerIDs:[...]}` -> dicatat/ditampilkan client.
  Jadi walaupun damage dari klien, prize resmi tetap dari server.
- `godModeHackCheck()` hanya memvalidasi total poin atribut (wind+fire+lightning+water+earth
  <= level) ? BUKAN damage battle. Tidak menghalangi auto-kill.

### Kesimpulan alur battle

- `start_atb` hanya memulai siklus ATB; bukan prompt untuk mengirim aksi atau kemenangan.
- Setelah setiap `start_atb`, semua client mengirim `{event:"info",state:"action",charId}` dari `Battle.tweenATBFinish()`.
- Client harus menunggu `{event:"command",state:"action",charId,...}`.
- Hanya socket dengan `charId` yang cocok mengirim `battle_command` lengkap dengan `targetId`.
- Setelah menerima `battle_action`, semua client mengirim `{event:"info",state:"action_finish",charId,char_dead}`.
- Server dapat mengirim `continue`, lalu client memulai siklus ATB berikutnya.
- `action_finish` bukan prompt aksi baru.
- Pengiriman `battle_win` mentah setelah `start_atb` sudah gagal pada validasi live dan tidak lagi dipakai.
- Mode lama `A`, `B`, dan `auto` kini memakai alur giliran server yang sama sampai strategi damage lengkap tersedia.

## 7. Captcha

`captcha_required` -> game calls `parent.postMessage({action:'show_captcha', ctx:'pve'},'*')`.
The web page `https://ninjasaga.cc/?minimal&air` renders/verifies the captcha in a real
browser. Verification payload includes challenge id, answer, hash, and `cc_mouse_trail`
(real mouse trail required -> use Playwright + real Edge).

## 8. Open items (still need user input)

1. Validasi live bahwa server mengirim `command/action` dan menerima `battle_command` bertarget.
2. Number of verified dummies & energy-regen policy (stop vs wait).
3. ToS/ban risk (user already accepted).
