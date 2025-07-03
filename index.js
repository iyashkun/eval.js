import { Bot, InputFile } from "grammy";
import { VM } from "vm2";
import axios from "axios";
import * as cheerio from "cheerio";
import puppeteer from "puppeteer";
import { performance } from "perf_hooks";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { emojiParser } from "@grammyjs/emoji";

const config = {
  BOT_TOKEN: process.env.BOT_TOKEN || "7094367315:AAGh9a9y0hmN1ggvSTXseCBADRk55X6N5E4",
  SUDOERS: process.env.SUDOERS?.split(",").map(Number) || [5896960462, 6668774864],
  PREFIXES: process.env.PREFIXES?.split(",") || ["/", "!", "?"],
};

const bot = new Bot(config.BOT_TOKEN);
bot.use(emojiParser());


const varStore = {};
const teskode = {};

function readableTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const msecs = Math.floor(ms % 1000);

  let result = "";
  if (days) result += `${days}d:`;
  if (hours) result += `${hours}h:`;
  if (minutes) result += `${minutes}m:`;
  if (secs || msecs) result += `${secs}.${msecs.toString().padStart(3, "0")}s`;
  return result.trim() || "0.1ms";
}

function formatError(error) {
  return `<b>⚠️ ᴇʀʀᴏʀ ᴡʜɪʟᴇ ᴇxᴇᴄᴜᴛɪɴɢ sɴɪᴘᴘᴇᴛ:</b>\n<pre>${error.message}</pre>`;
}

async function webScrap(url, options = {}) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36",
        ...options.headers,
      },
      ...options,
    });
    if (typeof data === "object") return data;
    const $ = cheerio.load(data);
    return { html: data, $ };
  } catch (error) {
    throw new Error(`Failed to scrape ${url}: ${error.message}`);
  }
}

async function browserScrap(url) {
  const browser = await puppeteer.launch({ headless: "new" });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2" });
    const content = await page.content();
    const $ = cheerio.load(content);
    return { html: content, $, screenshot: await page.screenshot() };
  } finally {
    await browser.close();
  }
}

async function evaluateCode(code, ctx) {
  let vmOutput = "";
  const vm = new VM({
    timeout: 5000,
    sandbox: {
      app: bot,
      bot: bot,
      humantime: readableTime,
      msg: ctx.message || ctx.inlineQuery || null,
      m: ctx.message || ctx.inlineQuery || null,
      var: varStore,
      teskode,
      re: (pattern, flags) => new RegExp(pattern, flags),
      os,
      ctx: ctx,
      user: ctx.from || ctx.inlineQuery?.from || null,
      id: ctx.message?.reply_to_message?.from?.id || ctx.inlineQuery?.from?.id || null,
      sticker: ctx.message?.sticker?.file_id || null,
      ParseMode: { HTML: "HTML", MARKDOWN: "Markdown" },
      sendMessage: bot.api.sendMessage.bind(bot.api),
      copyMessage: bot.api.copyMessage.bind(bot.api),
      forwardMessage: bot.api.forwardMessage.bind(bot.api),
      sendPhoto: bot.api.sendPhoto.bind(bot.api),
      sendVideo: bot.api.sendVideo.bind(bot.api),
      deleteMessage: bot.api.deleteMessage.bind(bot.api),
      pinMessage: bot.api.pinChatMessage.bind(bot.api),
      MARKDOWN: "Markdown",
      HTML: "HTML",
      IKB: (text, callback_data) => ({ text, callback_data }),
      IKM: (buttons) => ({ inline_keyboard: buttons }),
      asyncio: { setTimeout, setInterval },
      cloudscraper: axios,
      json: JSON,
      string: JSON.stringify,
      aiohttp: axios,
      p: (...args) => (vmOutput += args.join(" ") + "\n"),
      print: (...args) => (vmOutput += args.join(" ") + "\n"),
      send: async (...args) => {
        if (ctx.message) return await ctx.reply(...args);
        if (ctx.inlineQuery) return await bot.api.sendMessage(ctx.inlineQuery.from.id, ...args);
        return null;
      },
      stdout: { write: (data) => (vmOutput += data) },
      traceback: formatError,
      webscrap: webScrap,
      fetch: axios,
      reply: ctx.message?.reply_to_message || null,
      requests: axios,
      soup: cheerio,
      help: (obj) => {
        vmOutput += JSON.stringify(Object.getOwnPropertyNames(obj), null, 2);
      },
      browserScrap,
      console: {
        log: (...args) => (vmOutput += args.join(" ") + "\n"),
      },
      _ret: [],
    },
    eval: false,
    wasm: false,
  });

  const transformedCode = `
    async function run() {
      const _ret = [];
      const result = await (async () => { ${code} })();
      if (result !== undefined) _ret.push(result);
      return _ret;
    }
    run();
  `;

  const start = performance.now();
  try {
    let result = await vm.run(transformedCode);
    if (result && result.__await__) result = await result;
    result = result.filter((x) => x !== null && x !== undefined);
    const output = vmOutput || (result.length ? result.join("\n") : "ɴᴏ ᴏᴜᴛᴘᴜᴛ");
    const timeTaken = readableTime(performance.now() - start);

    return {
      success: true,
      output: `<b>ɪɴᴘᴜᴛ:</b>\n<pre>${code}</pre>\n<b>ᴏᴜᴛᴘᴜᴛ:</b>\n<pre>${output}</pre>\n<b>ᴛɪᴍᴇ:</b> ${timeTaken}`,
      result,
    };
  } catch (error) {
    const timeTaken = readableTime(performance.now() - start);
    return {
      success: false,
      output: `${formatError(error)}\n<b>ᴛɪᴍᴇ:</b> ${timeTaken}`,
    };
  }
}

bot.command(["eval", "ex"], async (ctx) => {
  const code = ctx.match.trim();
  if (!code) {
    return ctx.reply("<b>❌ ᴄᴏᴅᴇ ɴᴏᴛ ғᴏᴜɴᴅ...</b>", { parse_mode: "HTML" });
  }

  if (!config.SUDOERS.includes(ctx.from.id)) {
    return ctx.reply("<b>🚫 ᴜɴᴀᴜᴛʜᴏʀɪꜱᴇᴅ!</b>", { parse_mode: "HTML" });
  }

  const message = await ctx.reply("<b>⏳ ᴘʀᴏᴄᴇssɪɴɢ...</b>", { parse_mode: "HTML" });
  const { success, output } = await evaluateCode(code, ctx);

  try {
    if (output.length > 4096) {
      const buffer = Buffer.from(output, "utf-8");
      await ctx.replyWithDocument(
        new InputFile(buffer, "result.html"),
        {
          caption: "<b>ʀᴇsᴜʟᴛ:</b> <code>ᴀᴛᴛᴀᴄʜᴇᴅ ᴅᴏᴄᴜᴍᴇɴᴛ ɪɴ ғɪʟᴇ.</code>",
          parse_mode: "HTML",
          reply_to_message_id: ctx.message.message_id,
        }
      );
    } else {
      await ctx.api.editMessageText(ctx.chat.id, message.message_id, output, {
        parse_mode: "HTML",
      });
    }
  } catch (error) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      message.message_id,
      formatError(error),
      { parse_mode: "HTML" }
    );
  }
});

bot.on("inline_query", async (ctx) => {
  if (!ctx.inlineQuery) return;
  if (!ctx.inlineQuery.from || !config.SUDOERS.includes(ctx.inlineQuery.from.id)) {
    return ctx.answerInlineQuery([
      {
        type: "article",
        id: "eval-error",
        title: "ᴇʀʀᴏʀ",
        description: "ᴜɴᴀᴜᴛʜᴏʀɪꜱᴇᴅ ᴜꜱᴇʀ",
        input_message_content: {
          message_text: "<b>🚫 ᴜɴᴀᴜᴛʜᴏʀɪꜱᴇᴅ!</b>\nᴏɴʟʏ ᴀᴜᴛʜᴏʀɪꜱᴇᴅ ᴜꜱᴇʀꜱ ᴄᴀɴ ᴜꜱᴇ ɪɴʟɪɴᴇ Qᴜᴇʀɪᴇꜱ.",
          parse_mode: "HTML",
        },
      },
    ], { cache_time: 0 });
  }
  
  const code = ctx.inlineQuery.query.trim();
  if (!code) {
    return ctx.answerInlineQuery([]);
  }

  try {
    const { success, output } = await evaluateCode(code, ctx);
    const resultText = output.length > 200 ? output.slice(0, 197) + "..." : output;
    await ctx.answerInlineQuery([
      {
        type: "article",
        id: "eval-result",
        title: success ? "ᴇᴠᴀʟᴜᴀᴛɪᴏɴ ʀᴇꜱᴜʟᴛ" : "ᴇʀʀᴏʀ",
        description: success ? "ᴄᴏᴅᴇ ᴇxᴇᴄᴜᴛᴇᴅ ꜱᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ" : "ᴇxᴇᴄᴜᴛɪᴏɴ ꜰᴀɪʟᴇᴅ",
        input_message_content: {
          message_text: resultText,
          parse_mode: "HTML",
        },
      },
    ], { cache_time: 0 });
  } catch (error) {
    await ctx.answerInlineQuery([
      {
        type: "article",
        id: "eval-error",
        title: "ᴇʀʀᴏʀ",
        description: "ꜰᴀɪʟᴇᴅ ᴛᴏ ᴘʀᴏᴄᴇꜱꜱ ɪɴʟɪɴᴇ Qᴜᴇʀʏ",
        input_message_content: {
          message_text: formatError(error),
          parse_mode: "HTML",
        },
      },
    ], { cache_time: 0 });
  }
});

bot.start().then(() => {
  console.log("💭 ʙᴏᴛ ꜱᴛᴀʀᴛᴇᴅ ꜱᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ !");
  bot.api.sendMessage(-1002038350326, "<b>Y700</b>", {
    parse_mode: "HTML",
  });
}).catch((err) => {
  console.error("ꜰᴀɪʟᴇᴅ ᴛᴏ ꜱᴛᴀʀᴛ ʙᴏᴛ:", err);
});
