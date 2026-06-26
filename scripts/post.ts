import { Client } from "@notionhq/client";
import { BskyAgent, RichText } from "@atproto/api";

// Environment variables
const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_ANSWERS_DB_ID = process.env.NOTION_ANSWERS_DB_ID!;
const BLUESKY_HANDLE = process.env.BLUESKY_HANDLE!;
const BLUESKY_APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD!;

const notion = new Client({ auth: NOTION_TOKEN });

// Initialize Bluesky agent
async function getBlueskyAgent(): Promise<BskyAgent> {
  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: BLUESKY_HANDLE,
    password: BLUESKY_APP_PASSWORD,
  });
  return agent;
}

// Resolve a database id to its primary data source id (Notion SDK v5)
async function getDataSourceId(databaseId: string): Promise<string> {
  const db: any = await notion.databases.retrieve({ database_id: databaseId });
  const sources = db.data_sources;
  if (!sources || sources.length === 0) {
    throw new Error(`No data source found for database ${databaseId}`);
  }
  return sources[0].id;
}

// Get scheduled answers (Scheduled At is in the past and Posted is false)
async function getScheduledAnswers() {
  const now = new Date().toISOString();
  const dataSourceId = await getDataSourceId(NOTION_ANSWERS_DB_ID);

  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    filter: {
      and: [
        {
          property: "Scheduled At",
          date: {
            on_or_before: now,
          },
        },
        {
          property: "Posted",
          checkbox: {
            equals: false,
          },
        },
      ],
    },
  });

  return response.results;
}

// Helper to extract properties from a Notion page
function getTextProperty(page: any, name: string): string {
  const prop = page.properties[name];
  if (!prop) return "";
  if (prop.type === "title") {
    return prop.title.map((t: any) => t.plain_text).join("");
  }
  if (prop.type === "rich_text") {
    return prop.rich_text.map((t: any) => t.plain_text).join("");
  }
  if (prop.type === "url") {
    return prop.url || "";
  }
  return "";
}

function getNumberProperty(page: any, name: string): number {
  const prop = page.properties[name];
  if (!prop || prop.type !== "number") return 0;
  return prop.number || 0;
}

// Count graphemes (Bluesky uses grapheme length for the 300 char limit)
export function graphemeLength(text: string): number {
  const segmenter = new Intl.Segmenter();
  return [...segmenter.segment(text)].length;
}

// Build post content, split into main and reply if needed
export function buildPostParts(answer: any): { main: string; reply: string | null } {
  const answerZh = getTextProperty(answer, "Answer (ZH)");
  const intendedJa = getTextProperty(answer, "Intended (JA)");
  const dayNumber = getNumberProperty(answer, "Day Number");
  const term = getNumberProperty(answer, "Term");

  // Get the question text from the Question relation property
  const questionRelation = answer.properties["Question"];
  let questionZh = "";
  if (
    questionRelation &&
    questionRelation.type === "relation" &&
    questionRelation.relation.length > 0
  ) {
    // Use pre-fetched question data from the related page
    questionZh = answer._questionZh || "";
  }

  const termSuffix = term > 1 ? `_term${term}` : "";

  const hashtags = `#中国語3行日記 #中文学习 #3行日记
#enoki_Day${dayNumber}${termSuffix}`;

  const intendedSection = `書きたかったこと:
${intendedJa}`;

  const full = `質問: ${questionZh}

回答:
${answerZh}

${intendedSection}

${hashtags}`;

  if (graphemeLength(full) <= 300) {
    return { main: full, reply: null };
  }

  const mainPost = `質問: ${questionZh}

回答:
${answerZh}

${hashtags}`;

  return { main: mainPost, reply: intendedSection };
}

// Post to Bluesky (optionally as a reply to a parent post)
async function postToBluesky(
  agent: BskyAgent,
  content: string,
  parent?: { uri: string; cid: string }
): Promise<{ uri: string; cid: string }> {
  const richText = new RichText({ text: content });
  await richText.detectFacets(agent);

  const record: any = {
    text: richText.text,
    facets: richText.facets,
    createdAt: new Date().toISOString(),
  };

  if (parent) {
    record.reply = {
      root: { uri: parent.uri, cid: parent.cid },
      parent: { uri: parent.uri, cid: parent.cid },
    };
  }

  const response = await agent.post(record);

  return { uri: response.uri, cid: response.cid };
}

// Mark the Notion page as posted
async function markAsPosted(pageId: string, blueskyUri: string) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Posted: {
        checkbox: true,
      },
      "Bluesky URI": {
        url: blueskyUri,
      },
      "Posted At": {
        date: {
          start: new Date().toISOString(),
        },
      },
      "Scheduled At": {
        date: null,
      },
    },
  });
}

// Fetch question text from a related page
async function fetchQuestionZh(questionPageId: string): Promise<string> {
  const page = await notion.pages.retrieve({ page_id: questionPageId });
  const prop = (page as any).properties["Question (ZH)"];
  if (!prop || prop.type !== "rich_text") return "";
  return prop.rich_text.map((t: any) => t.plain_text).join("");
}

// Main
async function main() {
  console.log("Starting scheduled post job...");

  const answers = await getScheduledAnswers();

  if (answers.length === 0) {
    console.log("No scheduled posts to process.");
    return;
  }

  console.log(`Found ${answers.length} scheduled post(s).`);

  const agent = await getBlueskyAgent();

  for (const answer of answers) {
    const page = answer as any;

    try {
      // Fetch question text from the related page
      const questionRelation = page.properties["Question"];
      if (
        questionRelation &&
        questionRelation.type === "relation" &&
        questionRelation.relation.length > 0
      ) {
        const questionPageId = questionRelation.relation[0].id;
        page._questionZh = await fetchQuestionZh(questionPageId);
      }

      const { main, reply } = buildPostParts(page);
      console.log(`Posting Day ${getNumberProperty(page, "Day Number")}...`);
      console.log(main);
      if (reply) {
        console.log(`[thread reply] ${reply}`);
      }
      console.log("---");

      const result = await postToBluesky(agent, main);

      if (reply) {
        await postToBluesky(agent, reply, result);
        console.log("Reply posted as thread.");
      }

      await markAsPosted(page.id, result.uri);

      console.log(`Posted successfully: ${result.uri}`);
    } catch (error) {
      console.error(`Error posting page ${page.id}:`, error);
    }
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
