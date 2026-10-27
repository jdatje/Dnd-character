# D&D Character

A phone app to play a D&D Beyond character at the table. It loads the character from D&D Beyond, keeps track of
spell slots, sorcery points, limited uses, HP and your own homebrew trackers while you play, and at the end of the
night sends the changes back to D&D Beyond (or gives you a checklist to tick off there yourself).

Separate from the DM dashboard, but runs next to it on the home server. No npm packages: Node 24 only.

## What is in it

- **Characters**: add as many D&D Beyond characters as you like (Settings, or tap the name at the top) and switch between them; each has its own trackers, notes, in-character lines and Actions list.
- **Header** on every screen: portrait and name (tap to switch character), heroic inspiration, notes, settings, HP (tap to damage, heal, set temp), AC, initiative, an in-character line (tap to shuffle, edit the lines in Settings).
- **Actions**: tap any action or spell and choose Show in Actions / Hide from Actions; hidden ones stay under More actions.
- **Tabs**: Actions, Spells, Checks (abilities, saves, skills, senses), Features, Other (Notes, Inventory, Speed & Defences, Proficiencies, Background & story).
- **Tracker strip** above the tab bar shows slots left, sorcery points and Tides; tap it for the **trackers sheet**: spell slots, sorcery points with Font of Magic both ways, Wild Magic (Tides of Chaos, d20 surge check, d100 surge table with the text from your sheet), every limited use from the sheet, your own trackers, short and long rest, End night.
- **Casting**: pick a slot (or the free cast from a feat). A Sorcerer spell with a slot offers the surge check; with Tides of Chaos spent it surges automatically (2024 rules) and Tides comes back.
- **Notes**: as many notes as you like, chips to switch, free text with `- ` lists, `[] ` checkboxes and `# ` headings.
- **Settings**: six styles, size slider (80–130%), in-character line on/off, keep screen on, characters, login cookie for sending back, AC by hand.
- Works on several devices at once (changes show up everywhere) and can be added to the phone's home screen.

## Sending changes back to D&D Beyond

D&D Beyond has no official API for this. The app does what D&D Beyond's own character sheet does: it trades your
login cookie (`CobaltSession`) for a short-lived token and sends small updates for HP, spell slots, limited uses and
inspiration. Afterwards it loads the sheet again and checks every value; anything that did not land stays on the
list. The cookie is stored only on the server (`ddb-auth.json` in the data folder, readable by root only) and is
never sent back to the browser.

Getting the cookie (on a PC): sign in on dndbeyond.com in Chrome, F12 > Application > Cookies >
https://www.dndbeyond.com, copy the Value of `CobaltSession`, paste it in Settings.

Your own trackers (homebrew, notebook stickies) only exist in this app.

## Server

Runs in container 106 (`dmdash`) as the systemd service `dnd-character` on port 3200, data in
`/var/lib/dnd-character`, private https address through Tailscale on port 8444. The app port is 3200, or the next free one (3210, 3220…) if something else uses 3200; it is kept in `/etc/dnd-character.env`.

First install, in the console of container 106 (`root@dmdash`):

```
[ -d /opt/dnd-character ] || git clone https://github.com/jdatje/dnd-character /opt/dnd-character; git -C /opt/dnd-character pull -q; bash /opt/dnd-character/deploy/setup.sh
```

(From the HomeDC Shell instead: put `pct exec 106 -- bash -c "…"` around it.)

**Updates install themselves**: a timer (`dnd-update.timer`) checks GitHub every 5 minutes and runs the update,
which rolls back by itself if the new version does not start. Open phones reload on their own when they notice the
new version (not while you are typing or have a window open). Update right now, inside container 106:

```
dnd-update
```

Turn automatic updates off: `systemctl disable --now dnd-update.timer` (running `dnd-update` by hand turns them on again).

Useful:

- Status: `pct exec 106 -- systemctl status dnd-character`
- Log: `pct exec 106 -- journalctl -u dnd-character -n 50 --no-pager`
- Back up the data: `pct exec 106 -- tar czf /root/dnd-character-backup.tgz -C /var/lib dnd-character`

## Development

```
npm start          # http://localhost:3200, data in ./data
npm test           # sheet parsing, trackers, and a full night against a stand-in D&D Beyond
```

Code: `server.js` (HTTP, D&D Beyond calls), `lib/sheet.js` (character JSON to what the app shows),
`lib/state.js` (every change, rests, end-of-night list), `lib/ddb.js` (reading and writing D&D Beyond),
`lib/html.js` (cleaning HTML), `public/` (the app).
