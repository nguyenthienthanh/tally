# Riêng tư

[English](./PRIVACY.md) · **Tiếng Việt** · [中文](./PRIVACY.zh.md)

tally đọc những file vốn đã nằm trên máy bạn và không gửi chúng đi đâu.

## Nó đọc gì

| Đường dẫn | Để làm gì |
|---|---|
| `~/.claude/projects/**/*.jsonl` | **metadata, số token và lời gọi tool** của từng request |
| `~/.claude.json` | hạng gói của bạn và các hằng số credit của chính Claude Code |
| `~/.claude/cache/rate-limits.json` | phần trăm hạn mức 5 giờ / 7 ngày hiện tại |
| `~/.claude/cache/usage-cycle.json` | chi phí tương đương API cho chu kỳ tính tiền |
| `~/.claude/usage-data/` | kết quả lệnh `/insights` của chính Claude Code |

## Nó không bao giờ đọc gì

**Chữ trong tin nhắn.** Bộ phân tích (`src/ingest/parse.ts`) duyệt `message.content` để đếm khối
`tool_use` và rút vài dữ kiện từ đó, rồi bỏ đi. Không có chữ tin nhắn, không có câu trả lời của
model, không có nội dung file nào tới được một sự kiện. Lược đồ database không có cột nào chứa được
những thứ đó. Cả hai điều này đều được test cưỡng chế.

## Nó giữ gì từ một lời gọi tool

Đọc là chuyện thoáng qua; index thì nằm lại trên đĩa, nên thứ nằm lại phải là tối thiểu. Từ mỗi lời
gọi tool, tally chỉ lưu giá trị đã rút:

| Giữ | Ví dụ |
|---|---|
| tên tool | `Bash`, `Read`, `mcp__playwright__browser_navigate` |
| động từ shell | `grep`, `pnpm`, `git` |
| đuôi file | `ts`, `png` |
| ba đoạn cuối đường dẫn | `src/engine/behaviour.ts` |
| một con số đếm | `n = 42` |

**Không bao giờ giữ:** chuỗi lệnh thô, tham số lệnh, nội dung file, URL, hay bất cứ thứ gì bạn gõ
trong một tin nhắn. Test khẳng định một dữ kiện đã tuần tự hoá không chứa những chuỗi có trong dữ
liệu gốc.

Lời hứa này hẹp hơn lời hứa mà tally từng nói trước khi có derived facts, và nó được nói hẹp một
cách cố ý. "Chúng tôi không đọc hội thoại của bạn" sẽ là một cách tiện lợi để mô tả việc đọc tham số
tool, và như thế là gây hiểu nhầm.

## Nó không bao giờ làm gì

- **Không có đường ra mạng.** Không telemetry, không analytics, không kiểm tra bản mới, không CDN.
  Bộ test quét mọi file nguồn tìm lời gọi có thể đi ra ngoài, và một test đầu-cuối sẽ đỏ nếu trang
  gọi tới bất kỳ host nào khác `127.0.0.1`.
- **Không ghi vào dữ liệu Claude của bạn**, trừ lượt làm mới `/insights` mà bạn duyệt rõ ràng. Index
  nằm trong `~/.tally/`.

## Hai thứ tốn của bạn

Cả hai đều tiêu **hạn mức gói Claude của chính bạn**, cả hai đều hỏi trước, và không cái nào chạy
lúc trang vừa mở.

| Hành động | Chạy cái gì | Giá |
|---|---|---|
| **Phân tích lại** ở trang Thói quen | `claude -p "/insights"` | đo được khoảng 303 credit (khoảng 0,15% trần 5 giờ của Max 20x) và khoảng 176 giây |
| **Nhờ Claude giải thích** | `claude -p` với những con số đang trên màn hình | vài KB đầu vào; trang hiện mức giá **đo từ chính các lượt headless bạn đã chạy**, và báo "chưa đo được" thay vì một con số gọn gàng khi có dưới 20 mẫu |

Đó là hai đường ghi duy nhất trong server: `POST /api/insight/refresh` và `POST /api/explain/run`.
Cả hai đòi một token sinh mới mỗi lần khởi động server và chỉ nhúng trong trang phục vụ cục bộ, cả
hai từ chối `GET`, cả hai chạy từng lượt một, và cả hai đều in một dòng ra terminal của bạn khi
chúng chạy.

Hành động giải thích chỉ gửi những con số trang đang hiện, theo ngôn ngữ và độ sâu bạn chọn, tới
binary `claude` cục bộ của chính bạn. Không có endpoint bên thứ ba nào dính vào.

## Chia sẻ ảnh màn hình

`tally serve --redact` thay đường dẫn dự án bằng hash có muối, nên vẫn gộp nhóm được mà không lộ tên
thư mục. Ảnh màn hình trong repo này chụp từ dữ liệu tổng hợp do `scripts/make-fixture.mjs` sinh ra,
không phải từ một tài khoản thật.
