import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  AttachmentBuilder,
} from "discord.js";
import Canvas, { registerFont } from "canvas";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

// (1) Підготовка БД (SQLite)
const dbFile = path.resolve("./reports.db");
const db = new Database(dbFile);
db.exec(`
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  static TEXT NOT NULL,
  operation TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

// (2) assets
const assetsDir = path.resolve("./assets");
const logoPath = path.join(assetsDir, "logo.png");
const signaturePath = path.join(assetsDir, "signature.png");
const stampPath = path.join(assetsDir, "stamp.png");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, () => {
  console.log(`✅ Увійшов як ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // --- команда для створення звіту
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "op_report"
    ) {
      if (
        process.env.REPORTS_CHANNEL_ID &&
        interaction.channelId !== process.env.REPORTS_CHANNEL_ID
      ) {
        return interaction.reply({
          content: "Ця команда доступна тільки в каналі Терапія.",
          ephemeral: true,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId("op_report_modal")
        .setTitle("Створити звіт про оперативне втручання");

      const fullNameInput = new TextInputBuilder()
        .setCustomId("full_name")
        .setLabel("ПІБ (Прізвище Ім’я)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const staticInput = new TextInputBuilder()
        .setCustomId("static")
        .setLabel("Static (унікальний ID)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const operationInput = new TextInputBuilder()
        .setCustomId("operation")
        .setLabel("Вид оперативного втручання")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const descriptionInput = new TextInputBuilder()
        .setCustomId("description")
        .setLabel("Короткий опис")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(fullNameInput),
        new ActionRowBuilder().addComponents(staticInput),
        new ActionRowBuilder().addComponents(operationInput),
        new ActionRowBuilder().addComponents(descriptionInput)
      );

      await interaction.showModal(modal);
      return;
    }

    // --- обробка модалі
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "op_report_modal"
    ) {
      await interaction.deferReply({ ephemeral: true });

      const fullName = interaction.fields.getTextInputValue("full_name").trim();
      const staticId = interaction.fields.getTextInputValue("static").trim();
      const operation = interaction.fields
        .getTextInputValue("operation")
        .trim();
      const description = interaction.fields
        .getTextInputValue("description")
        .trim();

      const now = new Date();
      const createdAt = now.toISOString();

      // запис у БД
      const insert = db.prepare(
        `INSERT INTO reports (full_name, static, operation, description, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      const info = insert.run(
        fullName,
        staticId,
        operation,
        description,
        createdAt
      );

      const reportId = info.lastInsertRowid;

      // генерація JPG
      const templateW = 1200;
      const templateH = 1200;
      const canvas = Canvas.createCanvas(templateW, templateH);
      const ctx = canvas.getContext("2d");

      ctx.fillStyle = "#afd6fdff";
      ctx.fillRect(0, 0, templateW, templateH);

      ctx.strokeStyle = "#2c3e50";
      ctx.lineWidth = 6;
      ctx.strokeRect(30, 30, templateW - 60, templateH - 60);

      if (fs.existsSync(logoPath)) {
        try {
          ctx.drawImage(await Canvas.loadImage(logoPath), 60, 60, 160, 160);
        } catch {}
      }

      ctx.fillStyle = "#0b3d91";
      ctx.font = "bold 48px Sans";
      ctx.textAlign = "center";
      ctx.fillText(
        "МІНІСТЕРСТВО ОХОРОНИ ЗДОРОВʼЯ ШТАТУ UKRAINE GTA5",
        240,
        100
      );

      ctx.font = "bold 32px Sans";
      ctx.fillStyle = "#000";
      ctx.fillText("Відділення ТЕРАПІЇ", 240, 130);

      ctx.font = "bold 48px Sans";
      ctx.fillStyle = "#000";
      ctx.fillText("ЗВІТ ПРО ОПЕРАТИВНЕ ВТРУЧАННЯ", templateW / 2, 220);

      ctx.textAlign = "left";
      ctx.font = "bold 20px Sans";
      ctx.fillText("Пацієнт:", 80, 300);

      ctx.font = "24px Sans";
      ctx.fillText(fullName, 200, 300);

      ctx.font = "bold 20px Sans";
      ctx.fillText("Static ID:", 80, 350);

      ctx.font = "24px Sans";
      ctx.fillText(staticId, 200, 350);

      ctx.font = "bold 20px Sans";
      ctx.fillText("Вид оперативного втручання:", 80, 410);

      ctx.font = "20px Sans";
      wrapText(ctx, operation, 80, 440, templateW - 160, 26);

      ctx.font = "bold 20px Sans";
      ctx.fillText("Короткий опис:", 80, 540);

      ctx.font = "18px Sans";
      wrapText(ctx, description, 80, 570, templateW - 160, 24);

      ctx.font = "20px Sans";
      ctx.textAlign = "left";
      ctx.fillText(`Звіт №${reportId}`, 80, templateH - 120);

      const formatDate = now.toLocaleDateString("uk-UA", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      ctx.textAlign = "center";
      ctx.fillText(
        `Дата видачі: ${formatDate}`,
        templateW / 2,
        templateH - 120
      );

      if (fs.existsSync(signaturePath)) {
        try {
          ctx.drawImage(
            await Canvas.loadImage(signaturePath),
            80,
            templateH - 320,
            240,
            120
          );
        } catch {}
        ctx.font = "16px Sans";
        ctx.textAlign = "left";
        ctx.fillText("Підпис лікаря", 80, templateH - 180);
      }

      if (fs.existsSync(stampPath)) {
        try {
          ctx.drawImage(
            await Canvas.loadImage(stampPath),
            templateW - 320,
            templateH - 380,
            220,
            220
          );
        } catch {}
      }

      const outPath = path.resolve(
        `./tmp/report_${reportId}_${now.getTime()}.jpg`
      );
      if (!fs.existsSync(path.dirname(outPath)))
        fs.mkdirSync(path.dirname(outPath), { recursive: true });

      const outStream = fs.createWriteStream(outPath);
      const jpegStream = canvas.createJPEGStream({
        quality: 0.9,
        chromaSubsampling: true,
      });
      jpegStream.pipe(outStream);

      await new Promise((res, rej) =>
        outStream.on("finish", res).on("error", rej)
      );

      const channel =
        interaction.channel ||
        (process.env.REPORTS_CHANNEL_ID
          ? await client.channels.fetch(process.env.REPORTS_CHANNEL_ID)
          : null);

      const attachment = new AttachmentBuilder(outPath);

      await channel.send({
        content: `🧾 Звіт №${reportId} — ${fullName} (Static: ${staticId})`,
        files: [attachment],
      });

      await interaction.editReply({
        content: `✅ Звіт згенеровано (№${reportId}) і відправлено.`,
      });

      return;
    }

    // --- пошук історії
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "op_history"
    ) {
      const by = interaction.options.getString("by");
      const query = interaction.options.getString("query");

      let rows = [];

      if (by === "name") {
        const stmt = db.prepare(
          `SELECT * FROM reports WHERE full_name LIKE ? ORDER BY id DESC LIMIT 50`
        );
        rows = stmt.all(`%${query}%`);
      } else if (by === "static") {
        const stmt = db.prepare(
          `SELECT * FROM reports WHERE static LIKE ? ORDER BY id DESC LIMIT 50`
        );
        rows = stmt.all(`%${query}%`);
      } else if (by === "id") {
        const stmt = db.prepare(`SELECT * FROM reports WHERE id = ?`);
        rows = stmt.all(query);
      }

      if (!rows.length)
        return interaction.reply({
          content: "❗ За запитом нічого не знайдено.",
          ephemeral: true,
        });

      const chunks = [];
      for (const r of rows.slice(0, 10)) {
        const created = new Date(r.created_at).toLocaleString("uk-UA");
        chunks.push(
          `**№${r.id}** — ${r.full_name} (Static: ${r.static}) — ${created}\nОперація: ${r.operation}\nОпис: ${r.description}`
        );
      }

      await interaction.reply({
        content: chunks.join("\n\n"),
        ephemeral: true,
      });

      return;
    }

    // --- останні записи
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "op_list"
    ) {
      const limit = interaction.options.getInteger("limit") || 5;

      const stmt = db.prepare(
        `SELECT * FROM reports ORDER BY id DESC LIMIT ?`
      );
      const rows = stmt.all(limit);

      if (!rows.length)
        return interaction.reply({
          content: "Немає записів.",
          ephemeral: true,
        });

      const out = rows
        .map((r) => {
          const created = new Date(r.created_at).toLocaleString("uk-UA");
          return `**№${r.id}** — ${r.full_name} (Static: ${r.static}) — ${created}`;
        })
        .join("\n");

      await interaction.reply({
        content: out,
        ephemeral: true,
      });

      return;
    }
  } catch (err) {
    console.error("Interaction error:", err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: "❌ Сталася помилка." });
      } else {
        await interaction.reply({
          content: "❌ Сталася помилка.",
          ephemeral: true,
        });
      }
    } catch {}
  }
});

// --- перенесення тексту для Canvas
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else {
      line = testLine;
    }
  }

  if (line) ctx.fillText(line, x, y);
}

client.login(process.env.TOKEN);
