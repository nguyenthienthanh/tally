# Kiến trúc

```
~/.claude/projects/**/*.jsonl ─┐
~/.claude.json                 │
~/.claude/cache/*.json         ├─► nạp ──► SQLite ──► engine ──► server ──► web
~/.claude/usage-data/**        ┘  (parse)  (~/.tally) (hàm thuần) (loopback) (JS thuần)
```

Không framework, không bundler, không phụ thuộc lúc chạy. Phụ thuộc production duy nhất là chính
Node.

## `src/ingest`: đọc transcript

| File | Việc |
| --- | --- |
| `scan.ts` | Quyết định đọc cái gì: dấu byte watermark theo từng file, và file nào đã đổi. |
| `parse.ts` | Biến một dòng JSONL thành một sự kiện dùng tài nguyên kèm các dữ kiện tool rút ra. **Quyền riêng tư được cưỡng chế ở đây.** |
| `toolfacts.ts` | Rút một dữ kiện an toàn từ một lời gọi tool: loại, động từ shell, đuôi file, đường dẫn rút gọn. |
| `db.ts` | Lược đồ, câu chèn, và các hàm đọc mà engine dùng. |
| `index.ts` | Điều phối, quét tăng dần, theo dõi file, đánh phiên bản cho derived facts. |

Hai chi tiết nên biết trước khi sửa gì ở đây:

- **Dòng cuối không có ký tự xuống dòng thì không bao giờ được tiêu thụ.** Claude Code có thể đang
  ghi dở. Một bản trước từng trừ đi một ký tự xuống dòng ảo và sinh ra watermark `-1`, SQLite vui vẻ
  lưu lại, rồi mọi lượt quét sau đều ném lỗi. Index hỏng vĩnh viễn cho tới khi chạy `--full`. Giờ đã
  có test ghi một nửa dòng thật vào một file thật.
- **`FACTS_VERSION`** canh phần derived facts. Tăng nó lên sẽ xoá `tool_facts` và các watermark đúng
  một lần, nên một bộ rút đã đổi không để sót dữ kiện nửa cũ. Bảng có từ trước một cột mới sẽ bị xoá
  và dựng lại lúc mở, vì `CREATE TABLE IF NOT EXISTS` im lặng về cột thiếu cho tới khi lần chèn đầu
  tiên thất bại.

## `src/engine`: hàm thuần

`credits`, `cost`, `summary`, `buckets`, `activity`, `sessions`, `findings`, `behaviour`. Chúng nhận
hằng số qua tham số và trả về dữ liệu trần. Không hàm nào mở file hay socket, nên rẻ để test.

Có một luật nhà nằm ở đây và đã bị phá năm lần: **hằng số đến từ nơi gọi**. Một hàm tự thò vào bảng
credit fallback bên trong sẽ lặng lẽ chấm một model chỉ có trong bảng live thành 0, và lặng lẽ tắt
nguyên một phát hiện.

## `src/server/serve.ts`: server cục bộ

- Chỉ gắn vào `127.0.0.1`.
- Mọi route là `GET` và chỉ đọc, trừ `POST /api/insight/refresh` và `POST /api/explain/run`. Cả hai
  cần header `x-tally-token`, cả hai từ chối `GET` bằng `405`, cả hai trả `409` khi đang chạy, và cả
  hai chỉ tiêu hạn mức của bạn sau khi bạn đồng ý trong trang.
- Token sinh mới mỗi lần khởi động server rồi chèn vào HTML. Nó không được lưu lại.
- `--redact` áp ở biên, nên đường dẫn đã hash là thứ trang NHẬN ĐƯỢC, chứ không phải thứ trang chọn
  hiển thị.
- Các cache (sự kiện, hiệu chuẩn, ô thời gian, phiên, hành vi) bị huỷ hiệu lực từ một chỗ duy nhất,
  theo trạng thái index. Một cache thứ hai khoá ở chỗ khác là một chỗ thứ hai phải nhớ dọn, và chỗ
  đó sẽ bị quên.

## `src/insight`: hai đường có dùng model

| Đường | Giá | Làm gì |
| --- | --- | --- |
| `import.ts` / `readings.ts` | miễn phí | Đọc kết quả `/insights` sẵn có của Claude Code và biến thành các số đọc có nhãn. |
| `run.ts` | đắt | Chạy chính `/insights` để tạo lại kết quả đó. |
| `explain.ts` | rẻ | Gửi những con số đang có trên màn hình cho `claude -p` và xin một lời giải thích. |

`/insights` không nhận tham số nào. Đó không phải phỏng đoán: định nghĩa lệnh trong binary Claude
Code ghi `contentLength: 0`, và bộ dựng prompt không bao giờ đọc tham số của nó. Nên gắn một nút chọn
ngôn ngữ hay độ sâu vào lệnh đó là gắn một cái nút giả. `explain.ts` tồn tại vì lý do đó: vài KB số
liệu đã đo, trong đó ngôn ngữ và độ sâu thật sự nằm trong prompt, với giá rẻ hơn khoảng 300 lần so
với chạy lại `/insights`.

Mức giá hiện ra trước khi bạn đồng ý là **đo được**, không phải giả định: tally lấy chính những phiên
`sdk-cli` ngắn của bạn trong index và báo trung vị. Dưới 20 mẫu thì nó báo "chưa đo được" thay vì một
con số gọn gàng.

## `web/`: trang

ES module thuần, không bước build. `app.js` dựng giao diện, `src/i18n/{vi,zh,en}.js` là từ điển
phẳng, `app.css` giữ các token. Thiết kế theo chủ đề console: hổ phách nghĩa là con người, xanh lạnh
nghĩa là thiết bị đo, và chữ mono chỉ dành cho giá trị đo được.

## Test

- **Unit** (`test/`, vitest): phân tích dòng, watermark, credit, chi phí, phát hiện, phiên, hành vi,
  che đường dẫn, giải thích. Có cả một ca "dữ liệu lớn" 3.000 dòng để bộ lập kế hoạch bị thử trên
  một file thật chứ không phải trên kế hoạch của chính nó.
- **Đầu-cuối** (`e2e/`, Playwright): server thật trên index thật, ở khung desktop và điện thoại. Một
  test khẳng định trang không bao giờ gọi tới host nào khác `127.0.0.1`.
- **CI** chạy unit test trên Node 22.13, 24 và 26, rồi chạy đầu-cuối trên bộ dữ liệu tổng hợp dựng
  bằng `scripts/make-fixture.mjs`. Script này từ chối chạy nếu `~/.claude.json` đã tồn tại, nên nó
  không bao giờ đè lên một máy thật.
