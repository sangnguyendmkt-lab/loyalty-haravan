# Loyalty Haravan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Google Sheets file "Loyalty Haravan" with an Apps Script menu that turns Google Form claims + Haravan orders/customers into a weekly `.xlsx` loyalty import file, with a permanent ledger so no order is credited twice.

**Architecture:** Pure business logic lives in `src/rules.js` (no Google APIs) and is unit-tested in Node with `node:test`. Thin Apps Script layers wrap it: `haravan.js` (API + mapping), `sheets.js` (sheet I/O + layout), `batch.js` (batch lifecycle), `menu.js` (UI). Apps Script has one global scope, so every file declares top-level functions and ends with a guarded `module.exports` for Node.

**Tech Stack:** Google Apps Script (V8), Node 22 `node:test` + `node:assert/strict` for tests, no npm dependencies. Deployment = owner pastes `src/*.js` into the Apps Script editor (one `.gs` file per source file).

**Spec:** `docs/superpowers/specs/2026-10-20-loyalty-haravan-design.md`

## Global Constraints

- Haravan API base `https://apis.haravan.com/com/`, header `Authorization: Bearer <token>`; Private App scopes `com.read_orders`, `com.read_customers` only — code must only issue GET requests.
- Token stored only in `PropertiesService.getScriptProperties()` key `HARAVAN_TOKEN`; never written to a cell or logged.
- Old file `1yICSQ4bGpCQxMIJ_98PlD8ka6IRT-bt3xt6toQNGN_8` is read-only for the system (form sheet `Dữ Liệu Gốc`, header on row 2, data from row 3, columns A–F).
- Defaults in sheet `Cài đặt`: data start `2025-08-01`, `100000` VND per point, multipliers `Silver=1, Gold=3, Platinum=5`, wait days `15`.
- Points per order: `Math.round(valueAfterDiscount / vndPerPoint * multiplier)`; empty tier = Silver; any other unknown tier → review.
- Export: sheet `Sheet1`, header row then 10 columns in this exact order and spelling: `Họ và tên | Số điện thoại | Email | Phường/Xã | Quận/Huyện | Tỉnh/Thành phố | Chi tiêu tích luỹ trong kỳ | Tổng chi tiêu | Điểm thưởng | Ngày đặt hàng cuối cùng`. Phone text with leading 0; both spend columns text `4,340,000`; points integer; date text `yyyy-MM-ddTHH:mm:ss+07:00`; ward/district empty.
- File name `loyalty_yyyy-MM-dd.xlsx` in Drive folder `Loyalty Exports`.
- All user-facing text in Vietnamese.
- Ledger/history rows are plain values, never formulas.

## Review Focus

1. Form phones arriving as numbers (Sheets drops the 0 → 9 digits), with `'`, spaces, dots, `+84`/`84` prefix — must normalize to the same 10-digit key as Haravan's 9-digit export. Pinned in Task 1.
2. Order codes typed with lowercase/spaces or matching only the partner tracking code — must still match. Pinned in Task 2.
3. One phone with several credited orders in one batch → exactly one export row with summed spend/points and max date. Pinned in Task 3.
4. Form timestamp is a `dd/MM/yyyy HH:mm:ss` string (not a Date) — ordering for "first claimant wins" must be chronological, not lexical. Pinned in Task 1 + Task 2.
5. Haravan money/number fields arriving as strings or null discount — value must be total *after* discount as a number. Pinned in Task 6 mapping tests.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | `"test": "node --test tests/"`, no deps |
| `src/rules.js` | Normalization, formatting, evaluation (8 steps), points, export rows, report aggregation |
| `src/haravan.js` | HTTP GET with paging/retry, `toOrder`, `toCustomer`, probe |
| `src/sheets.js` | Sheet names/headers constant, `setupSheets`, readers/writers, protections |
| `src/batch.js` | `createBatch`, `exportBatch`, `confirmBatch`, `cancelBatch`, order sync |
| `src/menu.js` | `onOpen` menu, dialogs, token setup, `onEdit` timestamp for pasted customers |
| `tests/*.test.js` | Node tests for `rules.js` and `haravan.js` mapping |
| `docs/huong-dan-su-dung.md` | One-page staff guide (Vietnamese) |

### Shared data shapes (defined in `src/rules.js` JSDoc, used everywhere)

```js
// Submission  {row:number, timestamp:Date, channel:string, name:string, phoneRaw:string, email:string, codeRaw:string}
// Order       {id:string, name:string, marketplaceCode:string, partnerTrackingCode:string,
//              createdAt:Date, deliveredAt:Date|null, delivered:boolean, voided:boolean,
//              valueAfterDiscount:number, province:string}
// Customer    {phone:string, name:string, email:string, province:string, tier:string,
//              points:number, totalSpent:number, periodSpent:number, lastOrderAt:Date|null}
// LedgerEntry {code:string, orderId:string, phone:string, channel:string, orderCreatedAt:Date|null,
//              value:number, tier:string, multiplier:number, points:number, batchId:string, source:string}
// Settings    {formSpreadsheetId, formSheetName, dataStart:Date, vndPerPoint:number,
//              multipliers:{[tier:string]:number}, waitDays:number, customerSource:'api'|'sheet'}
// Credit      {submission, order, phone, tier, multiplier, points}
// ReviewItem  {submission, kind:'warn'|'wait', reason:string}
```

Every source file ends with:
```js
if (typeof module !== 'undefined') module.exports = { /* this file's functions */ };
```

---

### Task 1: Scaffold + normalization/formatting helpers

**Files:**
- Create: `package.json`, `src/rules.js`, `tests/normalize.test.js`

**Interfaces:**
- Produces: `normalizePhone(raw:any) -> string|null`, `normalizeCode(raw:any) -> string`, `parseFormTimestamp(v:Date|string) -> Date|null`, `formatVnd(n:number) -> string`, `formatIsoVN(d:Date) -> string`

- [ ] **Step 1: Write failing tests** in `tests/normalize.test.js`:
```js
assert.equal(normalizePhone('0397192888'), '0397192888');
assert.equal(normalizePhone(397192888), '0397192888');          // number, 9 digits
assert.equal(normalizePhone("'0397 192.888"), '0397192888');
assert.equal(normalizePhone('+84 397-192-888'), '0397192888');
assert.equal(normalizePhone('84397192888'), '0397192888');
assert.equal(normalizePhone('03971928'), null);
assert.equal(normalizePhone('abc0397192888'), null);
assert.equal(normalizePhone(''), null);
assert.equal(normalizeCode(' 260102193vs1hu '), '260102193VS1HU');
assert.equal(parseFormTimestamp('04/01/2026 09:52:54').toISOString(), '2026-01-04T02:52:54.000Z'); // +07:00
assert.ok(parseFormTimestamp('10/02/2026 08:00:00') > parseFormTimestamp('09/12/2025 23:00:00'));
assert.equal(parseFormTimestamp('xx'), null);
assert.equal(formatVnd(4340000), '4,340,000');
assert.equal(formatVnd(0), '0');
assert.equal(formatIsoVN(new Date('2026-08-21T11:14:05Z')), '2026-08-21T18:14:05+07:00');
```
- [ ] **Step 2:** `npm test` → FAIL (functions not defined).
- [ ] **Step 3: Implement** in `src/rules.js`. Phone: reject if any letter present; strip all non-digits; `84`+9 digits → `0`+9; 9 digits → `0`+9; accept only `/^0\d{9}$/`. Timestamps: form strings are Vietnam local time (UTC+7) regardless of script timezone — build with `Date.UTC(...) - 7h`. `formatIsoVN` likewise shifts +7h and formats manually (no `Utilities` so it runs in Node).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: add normalization and formatting helpers`.

---

### Task 2: Claim evaluation (8 steps) and points

**Files:**
- Modify: `src/rules.js`
- Create: `tests/evaluate.test.js`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces:
  - `REASONS` constant: `{TAKEN_BY_OTHER:'Đơn đã được người khác tích', PHONE_INVALID:'SĐT sai', NOT_FOUND:'Không tìm thấy (khai sai, scam, hoặc đơn trước 08/2025)', NOT_DELIVERED:'Chờ giao', WAITING_DAYS:'Chờ đủ N ngày', UNKNOWN_TIER:'Hạng không xác định'}` (`WAITING_DAYS` text has `N` replaced with `settings.waitDays` at use).
  - `buildOrderIndex(orders:Order[]) -> Map<string,Order>` keyed by `normalizeCode` of `marketplaceCode`, `partnerTrackingCode` and `name`; skips empty keys and `voided` orders.
  - `computePoints(value:number, tier:string, settings) -> {multiplier:number, points:number}|null` (null for unknown tier).
  - `evaluateSubmissions(submissions, ledger:LedgerEntry[], orderIndex, customersByPhone:Map<string,Customer>, settings, now:Date) -> {credits:Credit[], review:ReviewItem[]}`

- [ ] **Step 1: Write failing tests** — fixture builder `sub(row, ts, phone, code)`, order `ord(code, {deliveredAt, valueAfterDiscount})`, `now = 2026-10-20`, `waitDays 15`. One test per rule:
  - `skips claim whose code is in ledger with same phone` → not in credits, not in review.
  - `warns when ledger has code under other phone` → review `{kind:'warn', reason:REASONS.TAKEN_BY_OTHER}`.
  - `first claimant in batch wins, later different phone warned; same phone duplicate silently skipped` — two claims same code, timestamps `'05/01/2026 10:00:00'` and `'04/01/2026 09:00:00'` given in reverse array order → the 04/01 claimant is credited.
  - `invalid phone warned` → `PHONE_INVALID`.
  - `matches on partner tracking code and on lowercase/spaced code`.
  - `not found warned` → `NOT_FOUND`.
  - `undelivered order waits` → `{kind:'wait', reason:'Chờ giao'}`.
  - `delivered 14 days ago waits, 15 days ago credited` → `'Chờ đủ 15 ngày'` then credit.
  - `points use current tier: 2,270,000 Silver → 23; 815,000 Gold → 24; 915,000 Platinum → 46; no customer → Silver`.
  - `unknown tier "Diamond" warned` → `UNKNOWN_TIER`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement.** Sort submissions by `parseFormTimestamp`, tie-break by `row`. Apply checks in spec §5 order; a `Map<code, phone>` of this batch's credited/claimed codes implements step 3. Steps 6–7 go to review as `wait`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: evaluate form claims against ledger and orders`.

---

### Task 3: Export rows (merge with Haravan customers)

**Files:**
- Modify: `src/rules.js`
- Create: `tests/export.test.js`

**Interfaces:**
- Consumes: `Credit[]`, `Map<string,Customer>`.
- Produces:
  - `EXPORT_HEADERS` (the 10 headers, exact spelling from Global Constraints).
  - `buildExportRows(credits, customersByPhone) -> ExportRow[]` where `ExportRow = {name, phone, email, province, periodSpent:number, totalSpent:number, points:number, lastOrderAt:Date}`; sorted by phone.
  - `formatExportRow(r:ExportRow) -> any[10]` → `[name, phone, email, '', '', province, formatVnd(periodSpent), formatVnd(totalSpent), points, formatIsoVN(lastOrderAt)]`.

- [ ] **Step 1: Write failing tests:**
  - `existing customer: adds to old values and keeps Haravan name/email/province` — customer `{name:'Nguyễn Thị Trúc Linh', email:'', province:'Thành phố Hồ Chí Minh', points:37, totalSpent:5000000, periodSpent:3752200, lastOrderAt:2026-09-01}` + credit value 2,380,248 pts 24, form email `a@b.com`, order 2026-06-16 → `points 61, periodSpent 6132448, totalSpent 7380248, email 'a@b.com', name kept, lastOrderAt 2026-09-01` (not moved back).
  - `new customer uses form name/email and order province`.
  - `two credits same phone → one row, summed, lastOrderAt = max`.
  - `formatExportRow` → exact array incl. `'6,132,448'` and `'2026-09-01T...+07:00'`, empty ward/district.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement.** For blanks-only fill use first non-empty form value in chronological order.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: build Haravan export rows`.

---

### Task 4: Report aggregation

**Files:**
- Modify: `src/rules.js`
- Create: `tests/report.test.js`

**Interfaces:**
- Produces: `buildReport(ledger:LedgerEntry[], year:number) -> {[channel:'Total'|'Shopee'|'Tiktok']: {phones:number[12], value:number[12], points:number[12], pointValue:number[12], aov:number[12]}}`. Month from `orderCreatedAt` (fallback: batch date parsed from `batchId`), `phones` = distinct phones, `pointValue = points*1000`, `aov = round(value / orderCount)`, 0 when no orders. `Total` sums both channels (phones distinct across channels).

- [ ] **Step 1: Write failing tests** with 3 entries (2 Shopee same phone Jan, 1 Tiktok Feb) asserting each array cell.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: monthly loyalty report aggregation`.

---

### Task 5: New spreadsheet, layout, and ledger migration

**Files:**
- Create: `src/sheets.js`, `scripts/migrate-ledger.md` (record of what was migrated)

**Interfaces:**
- Produces:
  - `SHEETS` constant: `{SETTINGS:'Cài đặt', BATCH:'Đợt hiện tại', REVIEW:'Cần kiểm tra', LEDGER:'Sổ đơn đã tích', HISTORY:'Lịch sử', REPORT:'Báo cáo', CUSTOMERS:'Khách hàng Haravan', ORDERS:'Đơn Haravan'}` and `HEADERS` per sheet:
    - LEDGER: `Mã đơn | ID đơn Haravan | SĐT | Kênh | Ngày tạo đơn | Giá trị sau giảm | Hạng | Hệ số | Điểm | Mã đợt | Nguồn`
    - HISTORY: `Mã đợt | Tạo lúc | Người tạo | Số khách | Số đơn | Tổng điểm | Trạng thái | Người xác nhận/huỷ | Lúc xác nhận/huỷ | SĐT lỗi | File`
    - REVIEW: `Dòng form | Thời gian khai | Kênh | SĐT | Mã đơn | Loại | Lý do | Lần đầu thấy | Ghi chú`
    - ORDERS: `ID | Mã đơn | Mã đơn sàn | Mã vận chuyển đối tác | Ngày tạo | Ngày giao thành công | Đã giao | Huỷ/Hoàn | Giá trị sau giảm | Tỉnh | Cập nhật lúc`
  - `setupSheets()` (idempotent: creates missing sheets with headers, hides ORDERS, writes default settings), `readSettings() -> Settings`, `readLedger() -> LedgerEntry[]`, `appendLedger(entries)`, `readForm(settings) -> Submission[]`, `applyProtections(ownerEmail)`.

- [ ] **Step 1: Ask the owner** to confirm creating file "Loyalty Haravan" in their Drive, then create it with the Google Sheets/Drive connector and record its ID in `scripts/migrate-ledger.md`.
- [ ] **Step 2: Migrate ledger** — read old `Edit!A3:Q` via the connector; for rows with `Q='Done'` write LEDGER rows: code=`normalizeCode(F)`, orderId='', phone=`normalizePhone(D)`, channel=B, orderCreatedAt='' , value=K, tier=M, multiplier=N, points=O, batchId=`'CU-'+P`, source=`'Chuyển từ file cũ'`. Values only.
- [ ] **Step 3: Verify** distinct codes in LEDGER = **4,952** (expected from analysis) and no formula cells; report the number to the owner.
- [ ] **Step 4: Implement `src/sheets.js`** functions above; `readForm` opens `SpreadsheetApp.openById(settings.formSpreadsheetId)` read-only and maps `A..F` to `Submission` with `row` = sheet row number.
- [ ] **Step 5: Commit** `feat: sheet layout, readers/writers, migrated ledger`.

---

### Task 6: Haravan client, token setup, and API probe (spike checkpoint)

**Files:**
- Create: `src/haravan.js`, `src/menu.js`, `tests/haravan.test.js`, `tests/fixtures/order.sample.json`, `tests/fixtures/customer.sample.json`

**Interfaces:**
- Produces:
  - `haravanGet(path:string, params:object) -> object` (GET only, `muteHttpExceptions`, retry 3× on 429/5xx with 2s/4s/8s backoff, throws `Error('Haravan: <status> <short message>')`, never includes token in message).
  - `haravanGetAll(path, params, key, onPage?) -> object[]` paging `page`/`limit=50` until a short page.
  - `toOrder(raw) -> Order`, `toCustomer(raw) -> Customer` (pure, Node-tested).
  - `probeHaravan()` writes to a temporary sheet `Probe` the **field names only** (no customer PII) of 3 recent orders and 2 customers.
  - Menu `🎯 Loyalty` in `onOpen` with `⚙️ Cài đặt kết nối Haravan` (owner only: prompt → `setProperty('HARAVAN_TOKEN')`) and `🔍 Chạy thử API`.

- [ ] **Step 1: Implement `haravanGet/haravanGetAll`, `setupToken`, `probeHaravan`, `onOpen`.**
- [ ] **Step 2: Owner checkpoint** — guide owner to paste `sheets.js`, `haravan.js`, `menu.js` into Apps Script, run `setupSheets`, set token, click 🔍. Read `Probe` sheet.
- [ ] **Step 3: Decide mapping and report to owner**: which field carries marketplace code, partner tracking code, delivered date, voided/returned flag, total after discount; whether customer has points/tier/period spend. If customers lack loyalty fields set `customerSource='sheet'` default. If no delivered date exists, **stop and ask the owner** (spec §10).
- [ ] **Step 4: Write failing tests** with redacted fixtures saved from the probe (fake names/phones): `toOrder` yields `valueAfterDiscount` number from string `"1,821,506"`/number, null discount → total; `deliveredAt` Date or null; `voided` true for cancelled/returned. `toCustomer` normalizes 9-digit phone, empty tier → `''`.
- [ ] **Step 5:** `npm test` → FAIL, implement `toOrder/toCustomer`, `npm test` → PASS.
- [ ] **Step 6: Commit** `feat: Haravan client, mapping and probe`.

---

### Task 7: Incremental order sync

**Files:**
- Modify: `src/batch.js` (create), `src/sheets.js`

**Interfaces:**
- Consumes: `haravanGetAll`, `toOrder`, `SHEETS.ORDERS`.
- Produces: `syncOrders(deadlineMs:number) -> {done:boolean, fetched:number}` — reads `ORDERS_SYNC_CURSOR` (ISO `updated_at_min`, default `settings.dataStart`) and `ORDERS_SYNC_PAGE` from Script Properties; upserts by order ID; saves cursor/page after every page; returns `done:false` when `Date.now() > deadlineMs`. `readOrders() -> Order[]`.

- [ ] **Step 1: Implement.** Upsert via an in-memory `Map(id → rowIndex)` and one `setValues` per page.
- [ ] **Step 2: Verify in sheet** — run `syncOrders(Date.now()+300000)` repeatedly until `done:true`; ORDERS row count matches Haravan admin order count since 01/08/2025 (±orders created during sync); second run fetches only recent changes (`fetched` small).
- [ ] **Step 3: Commit** `feat: incremental Haravan order sync`.

---

### Task 8: Create batch (🚀)

**Files:**
- Modify: `src/batch.js`, `src/sheets.js`, `src/menu.js`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: `createBatch()` menu handler; `loadCustomers(phones:string[], settings) -> Map<string,Customer>` (API search by phone or CUSTOMERS sheet); Script Property `OPEN_BATCH` = JSON `{batchId:'yyyyMMdd-HHmm', createdAt, createdBy, credits:[...] }`; `onEdit(e)` storing `CUSTOMERS_UPDATED_AT` when CUSTOMERS sheet is edited.

- [ ] **Step 1: Implement** in order: `LockService.getDocumentLock().tryLock(1000)` else alert `'Đang có người xử lý, vui lòng chờ'`; block if `OPEN_BATCH` exists (`'Đợt trước chưa xác nhận hoặc huỷ'`); block if no token; if `customerSource='sheet'` block unless `CUSTOMERS_UPDATED_AT` is today (Asia/Ho_Chi_Minh) with message `'Dữ liệu khách hàng chưa được cập nhật hôm nay'`; run `syncOrders` — if not done, alert `'Đang tải đơn hàng, bấm 🚀 lần nữa để tiếp tục'` and stop; evaluate; build export rows; write BATCH (summary block rows 1–6, headers row 8, data row 9+ with phone column number format `@`), rewrite REVIEW keeping existing `Ghi chú` and `Lần đầu thấy` per (row form) key; save `OPEN_BATCH`; append HISTORY row status `Chờ upload`.
- [ ] **Step 2: Verify in sheet** with the backlog since 15/09/2026: summary counts add up (credited + warn + wait + silently skipped = form rows not in ledger); spot-check 3 credited customers by hand against Haravan admin.
- [ ] **Step 3: Commit** `feat: create loyalty batch`.

---

### Task 9: Export, confirm (full/partial), cancel

**Files:**
- Modify: `src/batch.js`, `src/menu.js`

**Interfaces:**
- Produces: `exportBatch()`, `confirmBatch()`, `cancelBatch()` menu handlers.

- [ ] **Step 1: Implement `exportBatch`** — refuse if no open batch or batch not created today (`'Đợt đã hết hạn, hãy Huỷ đợt và chạy lại'`); `SpreadsheetApp.create` temp file, rename first sheet `Sheet1`, set columns B,G,H,J format `@`, write `EXPORT_HEADERS` + `formatExportRow` rows; `UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/'+id+'/export?format=xlsx', {headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()}})`; save blob as `loyalty_yyyy-MM-dd.xlsx` into folder `Loyalty Exports` (create if missing); trash temp; show dialog with link and reminder `'Hãy upload lên Haravan ngay sau khi tải'`; store file URL in HISTORY.
- [ ] **Step 2: Implement `confirmBatch`** — HTML dialog: radio `Thành công toàn bộ` / `Thành công một phần` + textarea for failed phones (normalized with `normalizePhone`); append LEDGER entries for credits whose phone is not failed, `source='Hệ thống'`; update HISTORY row (`Đã upload` or `Đã upload một phần`, who, when, failed phones); clear `OPEN_BATCH` and BATCH data.
- [ ] **Step 3: Implement `cancelBatch`** — `ui.alert` YES/NO `'Bạn chắc chắn CHƯA upload file này lên Haravan?'`; on YES clear `OPEN_BATCH`/BATCH, HISTORY `Đã huỷ`.
- [ ] **Step 4: Verify** — open the exported file next to `upload_HRV_thanh_cong.xlsx`: same sheet name, headers, cell types (phone text with 0, spend text with commas, points number, date text). Confirm partial with 1 phone → that phone's codes absent from LEDGER and reappear credited on next 🚀. Cancel → LEDGER unchanged.
- [ ] **Step 5: Commit** `feat: export, confirm and cancel batch`.

---

### Task 10: Report sheet, protections, handover

**Files:**
- Modify: `src/sheets.js`, `src/menu.js`
- Create: `docs/huong-dan-su-dung.md`

**Interfaces:**
- Consumes: `buildReport`, `readLedger`.
- Produces: `writeReport(year)` called at the end of `confirmBatch`; menu item `📊 Cập nhật báo cáo`.

- [ ] **Step 1: Implement `writeReport`** — layout mirrors old `Tổng Kết` (blocks Total/Shopee/Tiktok × JAN–DEC with rows Phone, Giá Trị Đơn Hàng, Điểm Loyalty, Giá Trị Điểm, AOV).
- [ ] **Step 2: Implement `applyProtections(ownerEmail)`** — protect SETTINGS, LEDGER, HISTORY, REPORT, ORDERS, BATCH to owner only; REVIEW protected except column `Ghi chú`; CUSTOMERS editable. Run as owner.
- [ ] **Step 3: Write `docs/huong-dan-su-dung.md`** — weekly steps ①–⑤ from the spec, what each review reason means, what to do on partial failure.
- [ ] **Step 4: Handover checks with owner** — share with the 2 staff Gmail accounts; staff account cannot edit `Cài đặt`/`Sổ đơn đã tích`; owner rotates token in Haravan and re-enters via ⚙️; 🔍 probe succeeds with new token; delete `Probe` sheet.
- [ ] **Step 5: Commit** `feat: report, protections and staff guide`.
