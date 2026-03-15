import { Client } from "@notionhq/client";

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_QUESTIONS_DB_ID = process.env.NOTION_QUESTIONS_DB_ID!;

if (!NOTION_TOKEN) {
  console.error("❌ Environment variable NOTION_TOKEN is not set");
  process.exit(1);
}
if (!NOTION_QUESTIONS_DB_ID) {
  console.error("❌ Environment variable NOTION_QUESTIONS_DB_ID is not set");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch all pages from the DB (with pagination) */
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
    process.stdout.write(`\r  Fetched: ${pages.length} pages`);

    if (!response.has_more) break;
    cursor = response.next_cursor ?? undefined;
  }

  console.log();
  return pages;
}

/** Delete all existing blocks from a page */
async function clearContent(pageId: string): Promise<void> {
  const response = await notion.blocks.children.list({ block_id: pageId });
  for (const block of response.results) {
    await notion.blocks.delete({ block_id: block.id });
  }
}

/** Write "DayXXX" to the page body */
async function writeContent(pageId: string, dayNumber: number): Promise<string> {
  const dayStr = `Day${String(dayNumber).padStart(3, "0")}`;

  await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: dayStr } }],
        },
      },
    ],
  });

  return dayStr;
}

/** Main */
async function main() {
  console.log("🔍 Fetching all pages from Questions DB...");
  const pages = await getAllPages();
  console.log(`✅ Fetched ${pages.length} pages in total\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] as any;
    const pageId = page.id;
    const dayNumber = page.properties["Day Number"]?.number;

    if (!dayNumber) {
      console.warn(`⚠️  [${i + 1}/${pages.length}] No Day Number → skipped (${pageId})`);
      skipped++;
      continue;
    }

    try {
      await clearContent(pageId);
      const dayStr = await writeContent(pageId, dayNumber);
      console.log(`✅ [${i + 1}/${pages.length}] ${dayStr} written`);
      success++;
    } catch (err) {
      console.error(`❌ [${i + 1}/${pages.length}] Failed Day${dayNumber}: ${err}`);
      failed++;
    }

    // API rate limit throttle
    await sleep(350);
  }

  console.log("\n========== Done ==========");
  console.log(`✅ Success: ${success}`);
  console.log(`⚠️  Skipped: ${skipped}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});