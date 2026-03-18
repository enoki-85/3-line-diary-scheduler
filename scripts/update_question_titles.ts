import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_QUESTIONS_DB_ID = process.env.NOTION_QUESTIONS_DB_ID!;

if (!NOTION_TOKEN) {
  console.error("❌ 環境変数 NOTION_TOKEN が設定されていません");
  process.exit(1);
}
if (!NOTION_QUESTIONS_DB_ID) {
  console.error("❌ 環境変数 NOTION_QUESTIONS_DB_ID が設定されていません");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** DBの全ページを取得（ページネーション対応） */
async function getAllPages() {
  const pages: any[] = [];
  let cursor: string | undefined = undefined;

  while (true) {
    const response = await notion.databases.query({
      database_id: NOTION_QUESTIONS_DB_ID,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    pages.push(...response.results);
    process.stdout.write(`\r  取得済み: ${pages.length} 件`);

    if (!response.has_more) break;
    cursor = response.next_cursor ?? undefined;
  }

  console.log();
  return pages;
}

/** ページの既存ブロックを全削除 */
async function clearContent(pageId: string): Promise<void> {
  const response = await notion.blocks.children.list({ block_id: pageId });
  for (const block of response.results) {
    await notion.blocks.delete({ block_id: block.id });
  }
}

/** メイン処理 */
async function main() {
  console.log("🔍 Questions DB の全ページを取得中...");
  const pages = await getAllPages();
  console.log(`✅ 合計 ${pages.length} 件取得完了\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] as any;
    const pageId = page.id;
    const dayNumber: number | null = page.properties["Day Number"]?.number;

    // Name（タイトル）から現在の質問文を取得
    const questionZh: string =
      page.properties["Name"]?.title
        ?.map((t: any) => t.plain_text)
        .join("") ?? "";

    if (!dayNumber || !questionZh) {
      console.warn(
        `⚠️  [${i + 1}/${pages.length}] Day Number または Name なし → スキップ (${pageId})`
      );
      skipped++;
      continue;
    }

    // 新しいタイトル: "Day215 今天的午餐和谁一起吃的?"
    const newTitle = `Day${String(dayNumber).padStart(3, "0")} ${questionZh}`;

    try {
      // Name（タイトル）を更新 + Question (ZH) に質問文を書き込む
      await notion.pages.update({
        page_id: pageId,
        properties: {
          Name: {
            title: [{ type: "text", text: { content: newTitle } }],
          },
          "Question (ZH)": {
            rich_text: [{ type: "text", text: { content: questionZh } }],
          },
        },
      });

      // 本文の DayXXX を削除
      await clearContent(pageId);

      console.log(`✅ [${i + 1}/${pages.length}] "${newTitle}"`);
      success++;
    } catch (err) {
      console.error(`❌ [${i + 1}/${pages.length}] 失敗 Day${dayNumber}: ${err}`);
      failed++;
    }

    await sleep(350);
  }

  console.log("\n========== 完了 ==========");
  console.log(`✅ 成功: ${success} 件`);
  console.log(`⚠️  スキップ: ${skipped} 件`);
  console.log(`❌ 失敗: ${failed} 件`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("致命的エラー:", err);
  process.exit(1);
});