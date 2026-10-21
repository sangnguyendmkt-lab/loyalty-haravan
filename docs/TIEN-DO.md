# Loyalty Haravan: Tiến độ và bàn giao

Cập nhật: 21/10/2026. Tệp này giúp người khác, hoặc một phiên Claude mới, nắm được toàn bộ bối cảnh.

## Tài nguyên

| Thứ | Vị trí |
|---|---|
| File mới (hệ thống) | Google Sheets "Loyalty Haravan" `1eyrrzO-lgX9Jk-YlofIgAq0wSHcyJoC3QwhgzohFE5s` |
| File cũ (chỉ đọc, chứa câu trả lời Google Form) | `1yICSQ4bGpCQxMIJ_98PlD8ka6IRT-bt3xt6toQNGN_8`, sheet `Dữ Liệu Gốc` |
| Haravan Private App | `Loyalty Export - Chi doc`, chỉ đọc Đơn hàng + Khách hàng. Token lưu trong Script Properties `HARAVAN_TOKEN` |
| Code | `src/*.js`. Ghép thành `dist/Loyalty.gs` bằng `./scripts/build-gs.sh`, rồi dán vào Apps Script (Mã.gs) |
| Trang chép code | https://claude.ai/artifact/4kxWJiJ7ABT6h8ctLuvZMg (`python3 scripts/build-copy-page.py dist/Loyalty.gs <out.html>`) |
| Thiết kế / kế hoạch | `docs/superpowers/specs/2026-10-20-loyalty-haravan-design.md`, `docs/superpowers/plans/2026-10-20-loyalty-haravan.md` |
| Hướng dẫn nhân viên | `docs/huong-dan-su-dung.md` |
| Kiểm thử | `npm test` (72 bài, Node 22) |

## Quyết định quan trọng (ngoài spec)

- **API khách hàng không có điểm/hạng**, nên khách hàng lấy từ sheet dán tay "Khách hàng Haravan". File dán phải là của **hôm nay** và **sau lần ✅ gần nhất**.
- **Dữ liệu đơn hàng từ API:**
  - mã đơn sàn = `name`/`order_number`
  - mã vận đơn = `fulfillments[].tracking_number`
  - đã giao = `carrier_status_code == 'delivered'` + `delivered_date`
  - giá trị = `total_price`
  - nguồn = `source_name` (`shopee`, `tiktokshop`)
- **Phạm vi bộ nhớ đệm:** chỉ cache đơn Shopee/TikTok trong **365 ngày** (Cài đặt "Số ngày giữ đơn"). Mỗi ngày tự dọn đơn cũ hoặc khác nguồn.
- **Chống cộng trùng:** mỗi **đơn Haravan** chỉ tích 1 lần, dù khai bằng mã đơn hay mã vận đơn. Kiểm tra cả trong đợt lẫn với Sổ.
- **Phân quyền:** chỉ `Cài đặt` bị khoá hẳn; các sheet hệ thống chỉ cảnh báo, vì script chạy dưới tài khoản người bấm.
- **Báo cáo:** tháng tính theo thời điểm khai form, AOV = giá trị / số khách (giống Tổng Kết cũ).
- **Sổ đơn đã tích:** đã chép 4.952 đơn "Done" (47.028 điểm) từ file cũ. Chủ shop xác nhận không upload bằng file cũ sau 15/09/2026. **Không dùng lại quy trình cũ.**

## Trạng thái

- [x] Code xong, đã qua kiểm tra độc lập; lỗi Critical/Important đã sửa
- [x] File mới đã thiết lập, token đã cài, dữ liệu cũ đã chép
- [ ] Tải đơn lần đầu (đang chạy nền qua trigger `continueOrderSync`; đến 27/06/2026 thì có ~96k đơn)
- [ ] Giai đoạn 1: dán file khách hàng → 🚀 chạy thử → đối chiếu ~20 khách → kiểm tra file Excel → ❌ huỷ (chưa upload)
- [ ] Giai đoạn 2: chạy thật lần đầu → upload → ✅ → kiểm tra 3–5 khách trên Haravan
- [ ] Giai đoạn 3: chia sẻ cho 2 nhân viên (+ quyền xem file cũ) → 🔒 → đổi token (token cũ lộ trong ảnh chụp) → xoá sheet Probe

## Việc để sau (nhỏ)

- Thời gian khai form không đọc được thì đang được xếp lên đầu khi xét người khai trước.
- Chỉ mã vận đơn của lần giao đầu tiên được nhận.
- Nếu xoá tay dòng trong Sổ thì các đơn đó có thể được tích lại.
