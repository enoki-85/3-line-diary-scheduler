import { Client } from "@notionhq/client";
import { pinyin } from "pinyin-pro";
import fs from "fs";
import path from "path";

// Environment variables
const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_QUESTIONS_DB_ID = process.env.NOTION_QUESTIONS_DB_ID!;
const NOTION_ANSWERS_DB_ID = process.env.NOTION_ANSWERS_DB_ID!;

const notion = new Client({ auth: NOTION_TOKEN });

// CSV parser (handles fields containing newlines)
function parseCSV(content: string): Record<string, string>[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "\n" && !inQuotes) {
      lines.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) lines.push(current);

  if (lines.length === 0) return [];

  const headers = lines[0].split(",");
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values: string[] = [];
    let val = "";
    let inQ = false;

    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '"') {
        if (inQ && line[j + 1] === '"') {
          val += '"';
          j++;
        } else {
          inQ = !inQ;
        }
      } else if (c === "," && !inQ) {
        values.push(val);
        val = "";
      } else {
        val += c;
      }
    }
    values.push(val);

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header.trim()] = (values[index] || "").trim();
    });
    records.push(record);
  }

  return records;
}

// Rate limit helper: wait for the specified milliseconds
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Migrate questions
async function migrateQuestions(
  questions: Record<string, string>[]
): Promise<Map<string, string>> {
  // Mapping from Supabase id to Notion page_id
  const idMap = new Map<string, string>();

  console.log(`Migrating ${questions.length} questions...`);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    try {
      const response = await notion.pages.create({
        parent: { database_id: NOTION_QUESTIONS_DB_ID },
        properties: {
          "Question (ZH)": {
            title: [{ text: { content: q.question_zh || "" } }],
          },
          "Day Number": {
            number: parseInt(q.day_number, 10),
          },
          ...(q.question_ja
            ? {
                "Question (JA)": {
                  rich_text: [{ text: { content: q.question_ja } }],
                },
              }
            : {}),
        },
      });

      idMap.set(q.id, response.id);

      if ((i + 1) % 10 === 0) {
        console.log(`  Questions: ${i + 1}/${questions.length}`);
      }

      // Notion API rate limit (~3 requests per second)
      await sleep(350);
    } catch (error) {
      console.error(`Error migrating question id=${q.id}:`, error);
    }
  }

  console.log(`Questions migration complete. ${idMap.size} records created.`);
  return idMap;
}

// Migrate answers
async function migrateAnswers(
  answers: Record<string, string>[],
  questionIdMap: Map<string, string>
): Promise<void> {
  console.log(`Migrating ${answers.length} answers...`);

  let successCount = 0;

  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];

    const notionQuestionId = questionIdMap.get(a.question_id);
    if (!notionQuestionId) {
      console.warn(
        `  Skipping answer id=${a.id}: question_id=${a.question_id} not found in map`
      );
      continue;
    }

    // Generate pinyin
    const answerPinyin = a.answer_zh
      ? pinyin(a.answer_zh, { toneType: "symbol", separator: " " })
      : "";

    // Get Day Number by joining with the questions CSV
    // (ideally answers CSV would include day_number, but we join here instead)
    const dayNumber = parseInt(a.day_number || "0", 10);

    try {
      const properties: any = {
        "Answer (ZH)": {
          title: [{ text: { content: a.answer_zh || "" } }],
        },
        "Answer (Pinyin)": {
          rich_text: [{ text: { content: answerPinyin } }],
        },
        Question: {
          relation: [{ id: notionQuestionId }],
        },
        Term: {
          number: parseInt(a.term, 10),
        },
        "Intended (JA)": {
          rich_text: [{ text: { content: a.intended_ja || "" } }],
        },
        "Draft (ZH)": {
          rich_text: [{ text: { content: a.draft_zh || "" } }],
        },
        Posted: {
          checkbox: !!a.bluesky_uri,
        },
      };

      // Day Number
      if (dayNumber > 0) {
        properties["Day Number"] = { number: dayNumber };
      }

      // Bluesky URI
      if (a.bluesky_uri) {
        properties["Bluesky URI"] = { url: a.bluesky_uri };
      }

      // Posted At
      if (a.posted_at) {
        properties["Posted At"] = {
          date: { start: new Date(a.posted_at).toISOString() },
        };
      }

      const page = await notion.pages.create({
        parent: { database_id: NOTION_ANSWERS_DB_ID },
        properties,
      });

      // Add correction notes as page body content
      if (a.correction_note) {
        await notion.blocks.children.append({
          block_id: page.id,
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: a.correction_note },
                  },
                ],
              },
            },
          ],
        });
      }

      successCount++;

      if ((i + 1) % 10 === 0) {
        console.log(`  Answers: ${i + 1}/${answers.length}`);
      }

      await sleep(400);
    } catch (error) {
      console.error(`Error migrating answer id=${a.id}:`, error);
    }
  }

  console.log(`Answers migration complete. ${successCount} records created.`);
}

// Main
async function main() {
  console.log("Starting migration...");

  // Load CSV files
  const questionsPath = path.join(process.cwd(), "data", "questions_rows.csv");
  const answersPath = path.join(process.cwd(), "data", "answers_rows.csv");

  if (!fs.existsSync(questionsPath)) {
    console.error(`questions CSV not found: ${questionsPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(answersPath)) {
    console.error(`answers CSV not found: ${answersPath}`);
    process.exit(1);
  }

  const questionsContent = fs.readFileSync(questionsPath, "utf-8");
  const answersContent = fs.readFileSync(answersPath, "utf-8");

  const questions = parseCSV(questionsContent);
  const answers = parseCSV(answersContent);

  console.log(`Loaded ${questions.length} questions, ${answers.length} answers.`);

  // Assign day_number to answers by joining with questions CSV
  const questionDayMap = new Map<string, string>();
  questions.forEach((q) => questionDayMap.set(q.id, q.day_number));
  answers.forEach((a) => {
    a.day_number = questionDayMap.get(a.question_id) || "0";
  });

  // 1. Migrate questions
  const questionIdMap = await migrateQuestions(questions);

  // 2. Migrate answers
  await migrateAnswers(answers, questionIdMap);

  console.log("Migration complete!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
