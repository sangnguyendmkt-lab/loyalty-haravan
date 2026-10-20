# Thiết kế hệ thống xuất file Loyalty Haravan

- **Ngày:** 20/10/2026
- **Trạng thái:** Chờ chủ shop duyệt
- **Người dùng:** Chủ shop + 2 nhân viên (mỗi người một Gmail riêng)

---

## 1. Mục tiêu

Mỗi tuần một lần, bấm nút để tạo ra **file `.xlsx` đúng định dạng import khách hàng của Haravan**, dùng để cộng điểm loyalty cho khách mua trên **Shopee/TikTok** đã khai đơn qua Google Form. Sau đó upload thủ công lên Haravan.

**Thành công nghĩa là:**
- Không cộng trùng điểm, không làm mất điểm cũ của khách.
- Nhân viên không phải copy/dán/xoá trùng/sửa công thức bằng tay.
- Không phải tải file đơn hàng nặng từ Haravan nữa.
- Lịch sử và báo cáo cố định, không bị thay đổi theo dữ liệu nguồn.

## 2. Nguồn dữ liệu

| Nguồn | Cách lấy | Ghi chú |
|---|---|---|
| Google Form (sheet *Dữ Liệu Gốc* trong file Loyalty cũ `1yICSQ4bGpCQxMIJ_98PlD8ka6IRT-bt3xt6toQNGN_8`) | Đọc trực tiếp, **chỉ đọc** | Giữ nguyên form và link form. Cột: Dấu thời gian, Kênh, Họ & Tên, SĐT, Email, Mã đơn Shopee/TikTok |
| Đơn hàng Haravan | API, Private App `Loyalty Export - Chi doc`, quyền `com.read_orders` | Lấy liên tục từ **01/08/2025**, đồng bộ tăng dần |
| Khách hàng Haravan | API `com.read_customers`; **dự phòng**: dán file xuất khách hàng vào sheet *Khách hàng Haravan* | Dùng dự phòng nếu API không trả về điểm/hạng (xác minh ở Giai đoạn 0) |

Private App chỉ có **quyền đọc** đơn hàng và khách hàng, mọi quyền khác là *Không có quyền*. Hệ thống không thể ghi gì lên Haravan.

## 3. Quy tắc nghiệp vụ đã chốt

### Điều kiện tích điểm
- **R1.** Chỉ tích cho đơn Shopee/TikTok mà khách **đã khai qua form** **và** có trên Haravan ở trạng thái **giao thành công**.
- **R3.** Mỗi mã đơn chỉ được tích **một lần, vĩnh viễn**. Form gửi trùng thì chỉ tính một lần. Đơn đã tích ở đợt trước thì không tích lại.
- **R4.** Mã đơn không tìm thấy trên Haravan bị coi là khai sai hoặc scam → không tích, đưa vào *Cần kiểm tra*.
- **R19.** Một mã đơn bị khai bởi nhiều SĐT → **người khai trước** được tích. Các lần khai sau → *Cần kiểm tra*.
- **R20.** Chỉ tích cho đơn đã giao thành công từ **N ngày** trở lên (mặc định **N = 15**, sửa được trong *Cài đặt*). Đơn chưa đủ ngày tự chờ sang đợt sau, nên không bao giờ phải trừ điểm.
- **R28.** Đơn cũ hơn 08/2025 (ngoài phạm vi dữ liệu) → *Cần kiểm tra*.

### Khách hàng và số điện thoại
- **R17.** Chuẩn hoá SĐT về 10 số bắt đầu bằng `0`: bỏ dấu cách, chấm, gạch; `+84`/`84` → `0`; 9 số thì thêm `0` ở đầu. Không hợp lệ → *Cần kiểm tra*.
- **R18.** Điểm luôn cộng cho **SĐT trên form**. SĐT trong đơn chỉ để tham khảo.
- **R15.** Khách **đã có** trên Haravan: giữ nguyên Họ tên, Email, Tỉnh/Thành trên Haravan. Dữ liệu từ form/đơn chỉ điền vào ô đang trống.
- **R16.** Khách **mới**: Họ tên và Email lấy từ form, Tỉnh/Thành lấy từ đơn hàng.

### Công thức điểm
- **R2.** `Điểm đơn = ROUND(Tổng cộng SAU giảm giá / 100.000 × Hệ số hạng)`
- Hệ số: **Silver ×1, Gold ×3, Platinum ×5**. Khách chưa có hạng tính là Silver. Tên hạng lạ → *Cần kiểm tra*.
- **R21.** Hệ số theo **hạng hiện tại trên Haravan lúc chạy**.
- **R22.** Trong cùng một đợt, mọi đơn tính theo hạng **trước** khi upload. Haravan tự xét lên hạng sau khi upload.
- **R23.** Làm tròn **theo từng đơn**.
- Mức 100.000đ/điểm và các hệ số nằm trong *Cài đặt*, chỉ chủ shop sửa được.

### Giá trị xuất (Haravan ghi đè khi upload)
- **R5.** Điểm thưởng = điểm hiện có trên Haravan + điểm mới.
- **R12.** Tổng chi tiêu = Tổng chi tiêu cũ + giá trị đơn mới (sau giảm giá).
- **R13.** Chi tiêu tích luỹ trong kỳ = chi tiêu trong kỳ cũ + giá trị đơn mới (sau giảm giá).
- **R14.** Ngày đặt hàng cuối cùng = **ngày mới nhất** giữa (ngày hiện có trên Haravan) và (ngày tạo thật của các đơn được tích trong đợt). Không bao giờ bị lùi.
- **R6.** Dữ liệu khách hàng phải là **mới nhất** ngay lúc chạy. Nếu lấy qua sheet dán tay, dữ liệu phải được cập nhật **trong ngày**, nếu không thì chặn chạy.
- **R8.** Phường/Xã và Quận/Huyện để trống.

### Vòng đời đợt
- **R24.** Đơn chỉ được ghi vào *Sổ đơn đã tích* khi bấm **✅ Xác nhận đã upload**.
- **R25.** Đợt trước chưa xác nhận hoặc chưa huỷ → không cho tạo đợt mới.
- Đợt chỉ có hiệu lực **trong ngày tạo**. Sang ngày khác phải huỷ và chạy lại.
- Hỗ trợ **xác nhận một phần**: nhân viên nhập danh sách SĐT bị Haravan báo lỗi. Các khách này không được ghi vào Sổ và sẽ được xét lại ở đợt sau.

### Chuyển đổi từ file cũ
- **R26.** 4.952 mã đơn có trạng thái `Done` trong sheet *Edit* của file cũ → ghi vào *Sổ đơn đã tích* (đánh dấu `Chuyển từ file cũ`).
- **R27.** Mọi lần khai form khác (chưa `Done`, hoặc chưa xử lý) → được xét lại theo quy tắc mới ở lần chạy đầu tiên.
- File cũ giữ nguyên làm lưu trữ, hệ thống mới **không sửa** gì trong file cũ.

### Phân quyền
- **R30.** Nhân viên được: tạo đợt, tải file, xác nhận, huỷ đợt, ghi chú trong *Cần kiểm tra*. Chỉ chủ shop được: sửa *Cài đặt*, đổi token. *Sổ đơn đã tích* và *Lịch sử* bị khoá, chỉ hệ thống (chạy dưới quyền chủ shop) ghi vào.

## 4. Kiến trúc

- **Nền tảng:** Google Apps Script gắn trong một **file Google Sheets mới** tên "Loyalty Haravan".
- **Menu `🎯 Loyalty`:** 🚀 Tạo file loyalty · 📥 Tải file Excel · ✅ Xác nhận đã upload · ❌ Huỷ đợt · ⚙️ Cài đặt kết nối Haravan.
- **Token:** lưu trong *Script Properties* (cài đặt ẩn của script), được nhập qua hộp thoại ⚙️. Không ghi vào ô nào của sheet.
- **Gọi API:** `https://apis.haravan.com/com/...` với header `Authorization: Bearer <token>`.

### Các sheet

| Sheet | Nội dung | Quyền |
|---|---|---|
| Cài đặt | ID file form, ngày bắt đầu dữ liệu (01/08/2025), số tiền/điểm, hệ số hạng, N ngày | Chỉ chủ shop |
| Đợt hiện tại | Tóm tắt + 10 cột đúng định dạng upload | Hệ thống |
| Cần kiểm tra | ⚠️/⏳ + lý do + lần đầu xuất hiện + cột ghi chú | Hệ thống; nhân viên chỉ sửa cột ghi chú |
| Sổ đơn đã tích | Mã đơn, mã đơn Haravan, SĐT, kênh, ngày tạo đơn, giá trị sau giảm, hạng, hệ số, điểm, mã đợt, nguồn | Khoá |
| Lịch sử | Mã đợt, thời điểm tạo, người tạo, số khách, số đơn, tổng điểm, trạng thái, người xác nhận/huỷ, SĐT lỗi | Khoá |
| Báo cáo | Theo tháng × (Tổng / Shopee / TikTok): số khách, giá trị đơn, điểm, giá trị điểm (1 điểm = 1.000đ), AOV, tính từ Sổ | Hệ thống |
| Khách hàng Haravan | Dán file xuất khách hàng (chỉ dùng khi API không có điểm/hạng) | Nhân viên dán |
| Đơn Haravan (ẩn) | Bộ nhớ đệm đơn hàng: mã đơn, mã vận chuyển đối tác, ngày tạo, ngày giao thành công, trạng thái, tổng cộng sau giảm, tỉnh | Hệ thống |

### Đồng bộ đơn hàng
Apps Script chạy tối đa 6 phút mỗi lần. Vì vậy hệ thống chỉ tải các đơn **cập nhật sau lần đồng bộ trước** (theo `updated_at`) rồi ghi đè vào bộ nhớ đệm theo mã đơn. Lần đầu tải toàn bộ từ 01/08/2025, có thể phải nối tiếp nhiều lượt; hệ thống lưu vị trí đang tải để chạy tiếp.

## 5. Luồng xử lý khi bấm 🚀

**Bước 0: Kiểm tra an toàn.** Chặn chạy nếu: có đợt đang mở, chưa có token hoặc token lỗi, dữ liệu khách hàng (dán tay) chưa cập nhật hôm nay, hoặc có người khác đang chạy (`LockService`).

**Bước 1: Lấy dữ liệu.** Đồng bộ đơn hàng, tải khách hàng, đọc toàn bộ form.

**Bước 2: Xét từng lần khai form theo thời gian tăng dần.** Mã đơn được chuẩn hoá (bỏ khoảng trắng, chữ in hoa), SĐT được chuẩn hoá (R17). Gặp điều kiện nào trước thì dừng ở đó:

| # | Điều kiện | Kết quả |
|---|---|---|
| 1 | Mã đơn đã có trong Sổ, cùng SĐT | Bỏ qua |
| 2 | Mã đơn đã có trong Sổ, khác SĐT | ⚠️ Đơn đã được người khác tích |
| 3 | Mã đơn đã được lần khai trước trong đợt dùng | Cùng SĐT → bỏ qua; khác SĐT → ⚠️ |
| 4 | SĐT không hợp lệ | ⚠️ SĐT sai |
| 5 | Không khớp mã đơn hay mã vận chuyển đối tác | ⚠️ Không tìm thấy (khai sai, scam, hoặc đơn trước 08/2025) |
| 6 | Chưa giao thành công | ⏳ Chờ giao |
| 7 | Giao chưa đủ N ngày | ⏳ Chờ đủ N ngày |
| 8 | Qua hết | ✅ Tích điểm |

Các lần khai ⚠️/⏳ không vào Sổ và được **xét lại ở mỗi lần chạy**.

**Bước 3: Tính điểm từng đơn** theo R2, R21–R23.

**Bước 4: Gộp theo SĐT, ghép với khách Haravan** theo R5, R12–R16.

**Bước 5: Ghi kết quả.** Ghi *Đợt hiện tại* (tóm tắt + 10 cột) và *Cần kiểm tra*. Đợt ở trạng thái `Chờ upload`. Chưa ghi gì vào Sổ.

## 6. Tải file, Xác nhận, Huỷ

### 📥 Tải file
Tạo `.xlsx` giống file mẫu đã upload thành công:
- 1 sheet `Sheet1`, dòng 1 là tiêu đề, 10 cột theo thứ tự: `Họ và tên | Số điện thoại | Email | Phường/Xã | Quận/Huyện | Tỉnh/Thành phố | Chi tiêu tích luỹ trong kỳ | Tổng chi tiêu | Điểm thưởng | Ngày đặt hàng cuối cùng`.
- SĐT là chữ, có số `0` ở đầu. Hai cột chi tiêu là chữ có dấu phẩy (`4,340,000`). Điểm là số nguyên. Ngày là chuỗi `yyyy-MM-ddTHH:mm:ss+07:00`.
- Lưu vào thư mục Drive "Loyalty Exports" với tên `loyalty_yyyy-MM-dd.xlsx`, kèm link tải.
- Chặn tải nếu đợt không được tạo trong ngày.
- Nhắc: upload ngay sau khi tải, vì thay đổi điểm trên Haravan trong khoảng thời gian chờ sẽ bị ghi đè.

### ✅ Xác nhận
- Hộp thoại hỏi kết quả: **toàn bộ** hoặc **một phần** (dán danh sách SĐT lỗi).
- Ghi các đơn của những khách thành công vào Sổ (giá trị cố định), ghi Lịch sử, đóng đợt.

### ❌ Huỷ
- Hỏi lại: *"Bạn chắc chắn CHƯA upload file này lên Haravan?"*
- Xoá kết quả đợt, ghi Lịch sử `Đã huỷ`, mở khoá.

### Lỗi
Lỗi API hoặc mạng → dừng lại, không ghi dữ liệu dở dang, báo lỗi bằng tiếng Việt. Mọi thao tác đều ghi người thực hiện và thời gian.

## 7. Tổ chức code

Phần logic tính toán được tách khỏi phần đọc/ghi Google Sheets và gọi API, để kiểm thử tự động được bằng Node.js:

| File | Vai trò |
|---|---|
| `rules.js` | Thuần logic: chuẩn hoá SĐT/mã đơn, 8 bước xét, tính điểm, gộp khách, định dạng dòng xuất. Không gọi API Google |
| `haravan.js` | Gọi API, phân trang, đồng bộ tăng dần |
| `sheets.js` | Đọc/ghi các sheet |
| `batch.js` | Vòng đời đợt: tạo, tải file, xác nhận, huỷ, khoá |
| `menu.js` | Menu, hộp thoại, cài token |
| `tests/` | Kiểm thử `rules.js` bằng dữ liệu mẫu từ file cũ |

## 8. Kiểm thử và triển khai

**Giai đoạn 0: Chạy thử API (chỉ đọc).** Xác minh:
- (a) API khách hàng có điểm thưởng/hạng/chi tiêu trong kỳ không.
- (b) Đơn có mã đơn sàn, mã vận chuyển đối tác, ngày giao thành công, trạng thái hoàn/huỷ không.

Kết quả khác dự kiến → báo chủ shop và điều chỉnh thiết kế trước khi code.

**Giai đoạn 1: Xây dựng.**
- Tạo file mới và các sheet.
- Chép 4.952 mã `Done` sang Sổ.
- Chủ shop dán code vào Apps Script (có hướng dẫn) và cài token qua ⚙️.

**Giai đoạn 2: Kiểm thử.**
- Kiểm thử tự động `rules.js` với các ca: trùng form, khác SĐT, SĐT sai, không tìm thấy, chưa giao, chưa đủ N ngày, khách mới/cũ, ngày không lùi, giữ tên/email Haravan.
- Chạy song song đợt tồn đọng sau 15/09/2026, đối chiếu tay khoảng 20 khách trước khi upload thật.
- So định dạng file xuất với file mẫu.

**Giai đoạn 3: Bàn giao.**
- Bật bảo vệ sheet theo R30, chia sẻ cho 2 nhân viên.
- **Tạo token mới** để thay token đã lộ trong ảnh chụp.
- Hướng dẫn sử dụng 1 trang.

## 9. Ngoài phạm vi

- Ghi điểm trực tiếp lên Haravan qua API (vẫn upload thủ công).
- Đổi Google Form hoặc link form.
- Trừ điểm cho đơn hoàn (đã tránh nhờ R20).
- Lưu lịch sử hạng theo thời gian (dùng hạng hiện tại, R21).

## 10. Rủi ro còn mở

| Rủi ro | Cách xử lý |
|---|---|
| API không trả điểm/hạng | Dùng sheet *Khách hàng Haravan* dán tay + kiểm tra dữ liệu cập nhật trong ngày |
| API không có ngày giao thành công | Hỏi lại chủ shop để chọn mốc thay thế (ví dụ ngày cập nhật trạng thái hoàn tất) |
| Điểm thay đổi trên Haravan giữa lúc tạo đợt và lúc upload | Đợt chỉ hiệu lực trong ngày + nhắc upload ngay |
| Lần đồng bộ đầu tiên quá lâu | Đồng bộ nối tiếp, lưu vị trí đang tải |
