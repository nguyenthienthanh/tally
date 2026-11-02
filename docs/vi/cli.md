# Tham chiếu CLI

Chạy `node dist/cli.js <lệnh>` từ bản clone, hoặc `tally <lệnh>` nếu bạn đã link bin. Chạy không kèm
lệnh thì nó in phần trợ giúp.

---

## `tally index`

Quét `~/.claude/projects/**/*.jsonl` vào SQLite tại `~/.tally/index.sqlite`.

| Cờ | Mặc định | Nghĩa |
| --- | --- | --- |
| `--full` | tắt | Quét lại mọi file từ byte 0 thay vì đi tiếp từ watermark. |

Quét tăng dần hoạt động thế nào, và vì sao chạy được ngay khi Claude Code đang ghi:

- Mỗi file mang một **dấu byte watermark**. Lần chạy sau đọc từ đó tới cuối file.
- **Dòng cuối không có ký tự xuống dòng thì không được tiêu thụ.** Claude Code có thể đang ghi dở;
  lần chạy sau sẽ đọc trọn dòng đó.
- Dòng hỏng thì được đếm rồi bỏ qua. Một dòng xấu không bao giờ làm gãy cả lượt quét vài gigabyte.
- Bản ghi được chèn bằng `INSERT OR IGNORE` trên `(request_id, uuid)`, nên một phiên chạy tiếp có
  ghi lại bản ghi cũ cũng không tạo ra bản trùng.

Kết quả in ra: số file thấy, quét, bỏ qua; số dòng tốt, hỏng, thiếu dữ kiện; và số bản ghi chèn mới.
"Thiếu dữ kiện" nghĩa là bản ghi không có phần tách `cache_creation`, nên không tách được ghi cache
5 phút với 1 giờ cho dòng đó.

---

## `tally report`

In chính những con số của dashboard, ngay trong terminal.

| Cờ | Mặc định | Nghĩa |
| --- | --- | --- |
| `--grain=` | `day` | `hour`, `day`, `month` hoặc `year`. |
| `--tz=` | múi giờ máy | Bất kỳ múi IANA nào, ví dụ `Asia/Ho_Chi_Minh` hoặc `UTC`. |

Thứ tự các mục: gói và trần của bạn, phần trăm 5 giờ và 7 ngày đang báo về, kết luận hiệu chuẩn,
credit và USD theo model, bảng gộp theo mức bạn chọn (12 ô gần nhất), và các phát hiện kèm số tiền.

---

## `tally serve`

Mở dashboard cục bộ.

| Cờ | Mặc định | Nghĩa |
| --- | --- | --- |
| `--port=` | `7777` | Cổng trên `127.0.0.1`. |
| `--tz=` | múi giờ máy | Múi giờ cho mọi con số chia ô. |
| `--watch` | tắt | Quét lại khi transcript đổi, có chống dội, rồi làm mới dữ liệu. |
| `--redact` | tắt | Thay đường dẫn dự án bằng hash có muối trước khi tới trang. |

Server chỉ gắn vào loopback. Mọi route đều là `GET` và chỉ đọc, trừ hai cái:

- `POST /api/insight/refresh` chạy chính lệnh `/insights` của Claude Code.
- `POST /api/explain/run` nhờ binary `claude` cục bộ giải thích những con số đang có trên màn hình.

Cả hai đòi header `x-tally-token` với token sinh lúc khởi động server và nhúng trong trang, cả hai
từ chối `GET`, và cả hai trả `409` khi đang có một lượt chạy. Cả hai đều tiêu hạn mức của bạn, nên
trang hỏi trước và hiện mức giá đo từ chính các lượt headless bạn đã chạy.

---

## `tally doctor`

Kiểm năm nguồn dữ liệu, in mỗi cái một dòng, kèm những cảnh báo đáng quan tâm:

- hạng gói, chế độ, và trần 5 giờ tính bằng credit
- hằng số credit lấy từ đâu (`live` từ `~/.claude.json` của bạn, hay bản fallback đi kèm) và phủ
  được bao nhiêu model
- hạn mức đang báo về và mốc chụp đã cũ bao lâu
- chi phí chu kỳ tính tiền và bạn đang ở đoạn nào của chu kỳ
- số file transcript và tổng dung lượng
- có bao nhiêu file session-meta và facet của `/insights`, kèm cảnh báo khi facet chỉ phủ một phần
  số phiên, vì khi đó mọi con số về chỗ vướng đều phải kèm cỡ mẫu
- lần quét index gần nhất, kèm cảnh báo khi nó đủ cũ để hiệu chuẩn báo `stale_index`

---

## Các đường dẫn tally dùng

| Đường dẫn | Đọc hay ghi |
| --- | --- |
| `~/.claude/projects/**/*.jsonl` | đọc |
| `~/.claude.json` | đọc |
| `~/.claude/cache/rate-limits.json` | đọc |
| `~/.claude/cache/usage-cycle.json` | đọc |
| `~/.claude/usage-data/**` | đọc, và chỉ ghi khi bạn duyệt lượt làm mới `/insights` |
| `~/.tally/index.sqlite` | ghi: chính index |
| `~/.tally/explain-<lang>.json` | ghi: bản giải thích gần nhất, theo từng ngôn ngữ |
