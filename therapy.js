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
const logoPath = path.join(assetsDir, "zvit.jpg");
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
      const templateW = 2970;
      const templateH = 2100;
      const canvas = Canvas.createCanvas(templateW, templateH);
      const ctx = canvas.getContext("2d");

      // Завантажуємо фон zvit.jpg на весь canvas
      if (fs.existsSync(logoPath)) {
        try {
          const bgImage = await Canvas.loadImage(logoPath);
          ctx.drawImage(bgImage, 0, 0, templateW, templateH);
        } catch {}
      }

      ctx.strokeStyle = "#2c3e50";
      ctx.lineWidth = 6;
      ctx.strokeRect(30, 30, templateW - 60, templateH - 60);

      ctx.fillStyle = "#300f54";
      ctx.font = "bold 56px Sans";
      ctx.textAlign = "center";
      ctx.fillText(
        "МІНІСТЕРСТВО ОХОРОНИ ЗДОРОВʼЯ ШТАТУ UKRAINE GTA5",
        templateW / 2,
        600
      );

      ctx.font = "bold 48px Sans";
      ctx.fillStyle = "#300f54";
      ctx.fillText("Відділення ТЕРАПІЇ", templateW / 2, 680);

      ctx.font = "bold 48px Sans";
      ctx.fillStyle = "#300f54";
      ctx.fillText("ЗВІТ ПРО ОПЕРАТИВНЕ ВТРУЧАННЯ", templateW / 2, 750);

      ctx.textAlign = "center";
      ctx.font = "bold 32px Sans";
      ctx.fillText("Пацієнт:", templateW / 2, 800);

      ctx.font = "40px Sans";
      ctx.fillText(fullName, templateW / 2, 840);

      ctx.font = "bold 32px Sans";
      ctx.fillText("Static ID:", templateW / 2, 900);

      ctx.font = "40px Sans";
      ctx.fillText(staticId, templateW / 2, 940);

      ctx.font = "bold 32px Sans";
      ctx.fillText("Вид оперативного втручання:", templateW / 2, 1000);

      ctx.font = "40px Sans";
      wrapTextCenter(ctx, operation, templateW / 2, 1040, templateW - 160, 45);

      ctx.font = "bold 32px Sans";
      ctx.fillText("Короткий опис:", templateW / 2, 1100);

      ctx.font = "32px Sans";
      wrapTextCenter(
        ctx,
        description,
        templateW / 2,
        1140,
        templateW - 300,
        40
      );

      ctx.fillStyle = "#300f54";
      ctx.font = "24px Sans";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";

      const padding = 20;
      const lineSpacing = 28;
      ctx.fillText(
        `Звіт №${reportId}`,
        canvas.width - padding - 60,
        canvas.height - padding - lineSpacing - 60
      );

      const currentDate = new Date();
      const formattedDate = currentDate.toLocaleDateString("uk-UA", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      ctx.fillStyle = "#300f54";
      ctx.font = "24px Sans";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";

      ctx.fillText(
        `Дата видачі: ${formattedDate}`,
        canvas.width - padding - 60,
        canvas.height - padding - 60
      );

      if (fs.existsSync(signaturePath)) {
        try {
          const sigImg = await Canvas.loadImage(signaturePath);
          const sigWidth = 240;
          const sigHeight = 120;
          ctx.drawImage(
            sigImg,
            templateW / 2 - sigWidth / 2,
            templateH - 820,
            sigWidth,
            sigHeight
          );
        } catch {}
        ctx.font = "16px Sans";
        ctx.textAlign = "center";
        ctx.fillText("Підпис лікаря", templateW / 2, templateH - 680);
      }

      if (fs.existsSync(stampPath)) {
        try {
          const stampImg = await Canvas.loadImage(stampPath);
          const stampSize = 220;
          ctx.drawImage(
            stampImg,
            templateW / 2 - stampSize / 2,
            templateH - 880,
            stampSize,
            stampSize
          );
        } catch {}
      }

      const buffer = canvas.toBuffer("image/jpeg", {
        quality: 0.9,
      });

      const channel =
        interaction.channel ||
        (process.env.REPORTS_CHANNEL_ID
          ? await client.channels.fetch(process.env.REPORTS_CHANNEL_ID)
          : null);

      const attachment = new AttachmentBuilder(buffer, {
        name: `report_${reportId}.jpg`,
      });

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
        const result = stmt.get(Number(query));
        rows = result ? [result] : [];
      }

      if (!rows.length)
        return interaction.reply({
          content: "❗ За запитом нічого не знайдено.",
          ephemeral: true,
        });

      const chunks = [];
      for (const r of rows.slice(0, 10)) {
        const created = new Date(r.created_at).toLocaleString("uk-UA");
        const description =
          r.description.length > 200
            ? r.description.substring(0, 197) + "..."
            : r.description;
        const operation =
          r.operation.length > 100
            ? r.operation.substring(0, 97) + "..."
            : r.operation;
        chunks.push(
          `**№${r.id}** — ${r.full_name} (Static: ${r.static}) — ${created}\nОперація: ${operation}\nОпис: ${description}`
        );
      }

      let content = chunks.join("\n\n");
      if (content.length > 2000) {
        content = content.substring(0, 1997) + "...";
      }

      await interaction.reply({
        content: content,
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

      const stmt = db.prepare(`SELECT * FROM reports ORDER BY id DESC LIMIT ?`);
      const rows = stmt.all(limit);

      if (!rows.length)
        return interaction.reply({
          content: "Немає записів.",
          ephemeral: true,
        });

      let out = rows
        .map((r) => {
          const created = new Date(r.created_at).toLocaleString("uk-UA");
          return `**№${r.id}** — ${r.full_name} (Static: ${r.static}) — ${created}`;
        })
        .join("\n");

      if (out.length > 2000) {
        out = out.substring(0, 1997) + "...";
      }

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

// --- перенесення тексту для Canvas (з центруванням)
function wrapTextCenter(ctx, text, centerX, startY, maxWidth, lineHeight) {
  const words = text.split(" ");
  let lines = [];
  let currentLine = "";

  for (let n = 0; n < words.length; n++) {
    const testLine = currentLine + (currentLine ? " " : "") + words[n];
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = words[n];
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  ctx.textAlign = "center";
  let y = startY;
  for (const line of lines) {
    ctx.fillText(line, centerX, y);
    y += lineHeight;
  }
}

client.login(process.env.TOKEN);
