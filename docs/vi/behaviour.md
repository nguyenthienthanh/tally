# Hành vi: ba làn

Đếm trần số lời gọi tool thì không trả lời được gì. "grep chạy 11.849 lần" chưa phải một dữ kiện về
bạn cho tới khi có ai đó nói **ai chạy nó**. Trên một máy chạy pipeline không người trông, phần lớn
không phải bạn.

Nên trước khi hiện bất kỳ tỉ lệ nào, tally chia mọi lời gọi tool vào ba làn.

| Làn | Là gì | Dò bằng cách nào |
| --- | --- | --- |
| **Bạn gõ** | Phiên bạn mở trong terminal | `entrypoint: cli`, không phải sidechain, không nằm trên đường tự động |
| **Subagent** | Subagent trong chính những phiên đó | `isSidechain: true` |
| **Máy tự chạy** | Job headless và agent trong worktree riêng | `entrypoint: sdk-cli`, **hoặc** thư mục làm việc nằm dưới `.claude/worktrees/agent-…` hay `~/.openclaw` |

## Vì sao thư mục làm việc lại quan trọng

Chỉ dùng `entrypoint` trông thì đủ mà thật ra không đủ. `claude -p` đúng là báo `sdk-cli`, nhưng một
agent chạy trong git worktree riêng vào bằng `cli` y hệt một người đang gõ.

Trên máy đã dựng ra nó, phân biệt này đẩy phần máy tự chạy **từ 4,7% lên 35,1%** của 86.474 lời gọi
tool. Một phần ba hành vi trên trang trước đó bị xếp vào mục "bạn".

## Mỗi làn được đo bằng gì

Cùng một cây thước cho cả ba, vì những con số không so được với nhau thì không dạy được điều gì:

- **Phần** trên tổng số lời gọi tool, và số phiên đứng sau nó.
- **Dò**: phần trăm lệnh shell chỉ để nhìn (`grep`, `head`, `tail`, `ls`, `cut`, `find`) chứ không
  đổi gì. Tính trên lệnh shell, không phải trên mọi lời gọi tool, vì như thế là lặng lẽ chia cho
  nhầm mẫu số.
- **Đọc ảnh**: phần trăm lần đọc file có đuôi là ảnh. Một pipeline render không người trông đọc
  khung hình và sprite liên tục; một người đọc code thì không.
- **Số lần đọc trên mỗi lần ghi**: `null` khi không có lần ghi nào, không bao giờ là `0`. "Không ghi
  gì" và "tỉ lệ bằng không" là hai câu khác nhau.
- **Chạy ở đâu**: những thư mục dự án mà làn đó đụng tới.

Ví dụ đo được trên chính máy đó:

| Làn | Lời gọi | Phần | Phiên | Dò | Đọc ảnh | Đọc/ghi |
| --- | --- | --- | --- | --- | --- | --- |
| Bạn gõ | 34.286 | 39,6% | 8 | 52,8% | 64,4% | 3,3 |
| Subagent | 21.833 | 25,2% | 6 | 57,3% | 0,9% | 75,8 |
| Máy tự chạy | 30.355 | 35,1% | 872 | 58,7% | **79,0%** | 2,5 |

79% số lần đọc file của làn máy tự chạy là ảnh. Đó là một pipeline render đang soi kết quả của chính
nó, tức là công việc đang làm đúng việc của nó. Đọc con số đó thành thói quen cá nhân rồi khuyên
người ta "đọc ít file lại" là lời khuyên không nhắm vào ai cả.

## Cái gì cố ý không bị gắn cờ

**Đọc lại cùng một file trong một phiên** đo được 1,8%. Nó được tính, được hiện ra, và **không** bị
nêu như một vấn đề, vì nó không phải vấn đề. Gắn cờ một thứ không phải vấn đề là dạy người ta bỏ qua
cả trang.

## Lệnh shell, gom theo việc chúng làm

Động từ được gom thành `probe`, `change`, `build`, `vcs`, `net` hoặc `script`. Động từ không hợp
nhóm nào thì vào **other**, không bao giờ vào một nhóm đoán bừa.

Rút động từ khó hơn lấy chữ đầu tiên, và rút sai thì sai im lặng:

- `cd ~/x && pnpm build` là một lượt build, không phải `cd`. Đếm ngây thơ đưa `cd` lên trên tất cả và
  che mất công việc thật.
- `python3 <<'TAG' … TAG` nhét nguyên một chương trình vào trong lệnh. Không bóc heredoc thì `import`
  và `PYEOF` bị đếm thành lệnh shell.
- `python3 -c "import json; print(1)"` làm đúng như vậy bên trong một chuỗi có nháy.
- `env`, `sudo`, `time`, `xargs` là lớp uỷ quyền: động từ thật là chữ kế tiếp.
- `do` và `then` không phải lớp bọc để nuốt. `do ls` là một lời gọi tới `ls`.

Mỗi lỗi trên đều từng là một con số sai trên màn hình, và mỗi lỗi đều được sửa ở bộ rút động từ chứ
không phải bằng cách cấm cửa triệu chứng.

## Cái gì rời khỏi bộ phân tích

Từ một lời gọi tool chỉ giữ lại giá trị đã rút: tên tool, động từ shell, đuôi file, ba đoạn cuối của
đường dẫn, và một con số đếm. Không bao giờ giữ chuỗi lệnh, không bao giờ giữ nội dung file, không
bao giờ giữ chữ trong tin nhắn. Test khẳng định một dữ kiện đã tuần tự hoá không chứa chuỗi gốc nào.
