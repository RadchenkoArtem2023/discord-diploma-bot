import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  Events,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import Canvas from "canvas";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

// Перевірка аргументу командного рядка для deploy
if (process.argv.includes("--deploy")) {
  const { REST } = await import("@discordjs/rest");
  const { Routes } = await import("discord-api-types/v10");

  const commands = [
    // ----------- ОПЕРАЦІЙНІ ЗВІТИ ----------------
    {
      name: "op_report",
      description: "Створити звіт про оперативне втручання (відкриває модаль).",
    },

    {
      name: "op_history",
      description: "Пошук звітів (по прізвищу/імʼя, static або номеру).",
      options: [
        {
          name: "by",
          type: 3, // STRING
          description: "Пошук по полю: name | static | id",
          required: true,
          choices: [
            { name: "name", value: "name" },
            { name: "static", value: "static" },
            { name: "id", value: "id" },
          ],
        },
        {
          name: "query",
          type: 3, // STRING
          description: "Текст пошуку (наприклад: Петренко або 83031 або 12)",
          required: true,
        },
      ],
    },

    {
      name: "op_list",
      description: "Показати останні N звітів (за замовчуванням 5).",
      options: [
        {
          name: "limit",
          type: 4, // INTEGER
          description: "Кількість записів",
          required: false,
        },
      ],
    },

    {
      name: "setup_buttons",
      description:
        "Створити повідомлення з кнопками для звітів (тільки для адмінів).",
    },
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    console.log("⏳ Регіструю всі команди...");
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log("✅ Усі команди успішно зареєстровано!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Помилка реєстрації:", error);
    process.exit(1);
  }
}

// Підключення власного шрифту
Canvas.registerFont(path.resolve("./LTDiploma.otf"), { family: "LTDiploma" });

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
  created_at TEXT NOT NULL,
  issued_by TEXT
);
`);

// Міграція: додаємо колонку issued_by якщо її немає
try {
  const tableInfo = db.prepare(`PRAGMA table_info(reports)`).all();
  const hasIssuedBy = tableInfo.some((col) => col.name === "issued_by");

  if (!hasIssuedBy) {
    db.exec(`ALTER TABLE reports ADD COLUMN issued_by TEXT`);
    console.log("✅ Колонка issued_by додана до таблиці reports");
  }
} catch (err) {
  console.error("Помилка міграції БД:", err);
}

// (2) assets
const assetsDir = path.resolve("./assets");
const logoPath = path.join(assetsDir, "zvit.jpg");
const signaturePath = path.join(assetsDir, "signature.png");
const stampPath = path.join(assetsDir, "stamp.png");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Увійшов як ${client.user.tag}`);

  // Автоочистка каналу звітів кожні 5 хвилин
  const CLEANUP_CHANNEL_ID = "1452278469391290559";
  const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 хвилин в мілісекундах

  async function cleanupChannel() {
    try {
      const channel = await client.channels.fetch(CLEANUP_CHANNEL_ID);

      if (!channel || !channel.isTextBased()) {
        console.error(
          "❌ Канал для очищення не знайдено або не є текстовим каналом"
        );
        return;
      }

      let deletedCount = 0;
      let lastMessageId = null;
      let hasMore = true;

      // Видаляємо повідомлення пачками по 100 (ліміт Discord API)
      while (hasMore) {
        const options = { limit: 100 };
        if (lastMessageId) {
          options.before = lastMessageId;
        }

        const messages = await channel.messages.fetch(options);

        if (messages.size === 0) {
          hasMore = false;
          break;
        }

        // Видаляємо повідомлення, які не старші 14 днів (обмеження bulkDelete)
        const messagesToDelete = [];
        const now = Date.now();

        for (const message of messages.values()) {
          // Пропускаємо повідомлення з кнопками (створені командою setup_buttons)
          if (message.components && message.components.length > 0) {
            continue;
          }

          const messageAge = now - message.createdTimestamp;
          // Discord дозволяє bulkDelete тільки для повідомлень не старших 14 днів
          if (messageAge < 14 * 24 * 60 * 60 * 1000) {
            messagesToDelete.push(message);
          } else {
            // Для старих повідомлень видаляємо по одному
            try {
              await message.delete();
              deletedCount++;
            } catch (err) {
              console.error(
                `Помилка видалення старого повідомлення: ${err.message}`
              );
            }
          }
        }

        if (messagesToDelete.length > 0) {
          try {
            await channel.bulkDelete(messagesToDelete, true);
            deletedCount += messagesToDelete.length;
          } catch (err) {
            console.error(`Помилка bulkDelete: ${err.message}`);
          }
        }

        if (messages.size < 100) {
          hasMore = false;
        } else {
          lastMessageId = Array.from(messages.values())[messages.size - 1].id;
        }
      }

      if (deletedCount > 0) {
        console.log(
          `🧹 Очищено ${deletedCount} повідомлень з каналу ${CLEANUP_CHANNEL_ID}`
        );
      }
    } catch (err) {
      console.error("❌ Помилка при очищенні каналу:", err);
    }
  }

  // Запускаємо очищення відразу при старті
  cleanupChannel();

  // Запускаємо очищення кожні 5 хвилин
  setInterval(cleanupChannel, CLEANUP_INTERVAL);
  console.log(
    `🔄 Автоочистка каналу ${CLEANUP_CHANNEL_ID} налаштована (кожні 5 хвилин)`
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // ========== ДИПЛОМ: Крок 1: Відображення модалі ==========
    // (Видалено - тепер дипломи створюються через кнопки)

    // ========== ТЕРАПІЯ: команда для створення звіту ==========
    if (interaction.commandName === "op_report") {
      const modal = new ModalBuilder()
        .setCustomId("op_report_modal")
        .setTitle("Створити звіт про оперативне втручання");

      const fullNameInput = new TextInputBuilder()
        .setCustomId("full_name")
        .setLabel("ПІБ (Прізвище Ім'я)")
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

      const issuedByInput = new TextInputBuilder()
        .setCustomId("issued_by")
        .setLabel("Видано (ПІБ того, хто видає)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(fullNameInput),
        new ActionRowBuilder().addComponents(staticInput),
        new ActionRowBuilder().addComponents(operationInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(issuedByInput)
      );

      await interaction.showModal(modal);
      return;
    }

    // ========== ТЕРАПІЯ: пошук історії ==========
    if (interaction.commandName === "op_history") {
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
          flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    // ========== ТЕРАПІЯ: останні записи ==========
    if (interaction.commandName === "op_list") {
      const limit = interaction.options.getInteger("limit") || 5;

      const stmt = db.prepare(`SELECT * FROM reports ORDER BY id DESC LIMIT ?`);
      const rows = stmt.all(limit);

      if (!rows.length)
        return interaction.reply({
          content: "Немає записів.",
          flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    // ========== СТВОРЕННЯ ПОВІДОМЛЕННЯ З КНОПКАМИ ==========
    if (interaction.commandName === "setup_buttons") {
      // Перевірка прав (тільки адміністратори можуть використовувати цю команду)
      if (!interaction.memberPermissions?.has("Administrator")) {
        return interaction.reply({
          content: "❌ Ця команда доступна тільки для адміністраторів.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("📋 Система управління звітами та дипломами")
        .setDescription(
          "**🎓 ДИПЛОМИ:**\n" +
            "• Терапевт - створити диплом терапевта\n" +
            "• Хірург - створити диплом хірурга\n" +
            "• Спеціаліст - створити диплом спеціаліста\n\n" +
            "**📝 ЗВІТИ:**\n" +
            "• Створити звіт - створити новий звіт про оперативне втручання\n" +
            "• Пошук по імені - знайти звіти за ПІБ пацієнта\n" +
            "• Пошук по Static - знайти звіти за Static ID\n" +
            "• Пошук по ID - знайти звіт за номером\n" +
            "• Останні звіти - показати останні 5 звітів"
        )
        .setColor(0x300f54)
        .setTimestamp();

      // Кнопки для дипломів
      const diplomaTherapistButton = new ButtonBuilder()
        .setCustomId("btn_diploma_therapist")
        .setLabel("Терапевт")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎓");

      const diplomaSurgeonButton = new ButtonBuilder()
        .setCustomId("btn_diploma_surgeon")
        .setLabel("Хірург")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎓");

      const diplomaSpecialistButton = new ButtonBuilder()
        .setCustomId("btn_diploma_specialist")
        .setLabel("Спеціаліст")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎓");

      // Кнопки для звітів
      const createReportButton = new ButtonBuilder()
        .setCustomId("btn_create_report")
        .setLabel("Створити звіт")
        .setStyle(ButtonStyle.Success)
        .setEmoji("📝");

      const searchByNameButton = new ButtonBuilder()
        .setCustomId("btn_search_name")
        .setLabel("Пошук по імені")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔍");

      const searchByStaticButton = new ButtonBuilder()
        .setCustomId("btn_search_static")
        .setLabel("Пошук по Static")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔍");

      const searchByIdButton = new ButtonBuilder()
        .setCustomId("btn_search_id")
        .setLabel("Пошук по ID")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🔍");

      const showRecentButton = new ButtonBuilder()
        .setCustomId("btn_show_recent")
        .setLabel("Останні звіти")
        .setStyle(ButtonStyle.Success)
        .setEmoji("📜");

      // Рядок з дипломами
      const rowDiplomas = new ActionRowBuilder().addComponents(
        diplomaTherapistButton,
        diplomaSurgeonButton,
        diplomaSpecialistButton
      );

      // Рядок з основними кнопками звітів
      const rowReports1 = new ActionRowBuilder().addComponents(
        createReportButton,
        showRecentButton
      );

      // Рядок з кнопками пошуку звітів
      const rowReports2 = new ActionRowBuilder().addComponents(
        searchByNameButton,
        searchByStaticButton,
        searchByIdButton
      );

      await interaction.reply({
        embeds: [embed],
        components: [rowDiplomas, rowReports1, rowReports2],
      });

      return;
    }

    // ========== ОБРОБКА НАТИСКАНЬ НА КНОПКИ ==========
    if (interaction.isButton()) {
      // Кнопки для дипломів
      if (
        interaction.customId === "btn_diploma_therapist" ||
        interaction.customId === "btn_diploma_surgeon" ||
        interaction.customId === "btn_diploma_specialist"
      ) {
        let diplomaType = "";
        let title = "";

        if (interaction.customId === "btn_diploma_therapist") {
          diplomaType = "therapist";
          title = "Отримати диплом Терапевта";
        } else if (interaction.customId === "btn_diploma_surgeon") {
          diplomaType = "surgeon";
          title = "Отримати диплом Хірурга";
        } else if (interaction.customId === "btn_diploma_specialist") {
          diplomaType = "specialist";
          title = "Отримати диплом Спеціаліста";
        }

        const modal = new ModalBuilder()
          .setCustomId(`diploma_modal_${diplomaType}`)
          .setTitle(title);

        const nameInput = new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Імʼя")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Наприклад: Іван")
          .setRequired(true);

        const surnameInput = new TextInputBuilder()
          .setCustomId("surname")
          .setLabel("Прізвище")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Наприклад: Петренко")
          .setRequired(true);

        const genderInput = new TextInputBuilder()
          .setCustomId("gender")
          .setLabel("Статік (необовʼязково)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Наприклад: 1111")
          .setRequired(false);

        const issuedByInput = new TextInputBuilder()
          .setCustomId("issued_by")
          .setLabel("Видано (ПІБ того, хто видає)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(surnameInput),
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(genderInput),
          new ActionRowBuilder().addComponents(issuedByInput)
        );

        await interaction.showModal(modal);
        return;
      }

      // Кнопка "Створити звіт"
      if (interaction.customId === "btn_create_report") {
        const modal = new ModalBuilder()
          .setCustomId("op_report_modal")
          .setTitle("Створити звіт про оперативне втручання");

        const fullNameInput = new TextInputBuilder()
          .setCustomId("full_name")
          .setLabel("ПІБ (Прізвище Ім'я)")
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

        const issuedByInput = new TextInputBuilder()
          .setCustomId("issued_by")
          .setLabel("Видано (ПІБ того, хто видає)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(fullNameInput),
          new ActionRowBuilder().addComponents(staticInput),
          new ActionRowBuilder().addComponents(operationInput),
          new ActionRowBuilder().addComponents(descriptionInput),
          new ActionRowBuilder().addComponents(issuedByInput)
        );

        await interaction.showModal(modal);
        return;
      }

      // Кнопка "Пошук по імені"
      if (interaction.customId === "btn_search_name") {
        const modal = new ModalBuilder()
          .setCustomId("search_name_modal")
          .setTitle("Пошук звітів по імені");

        const queryInput = new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Введіть ПІБ (Прізвище або Ім'я)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Наприклад: Петренко або Іван")
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
        await interaction.showModal(modal);
        return;
      }

      // Кнопка "Пошук по Static"
      if (interaction.customId === "btn_search_static") {
        const modal = new ModalBuilder()
          .setCustomId("search_static_modal")
          .setTitle("Пошук звітів по Static ID");

        const queryInput = new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Введіть Static ID")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Наприклад: 83031")
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
        await interaction.showModal(modal);
        return;
      }

      // Кнопка "Пошук по ID"
      if (interaction.customId === "btn_search_id") {
        const modal = new ModalBuilder()
          .setCustomId("search_id_modal")
          .setTitle("Пошук звіту по номеру");

        const queryInput = new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Введіть номер звіту")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Наприклад: 12")
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
        await interaction.showModal(modal);
        return;
      }

      // Кнопка "Останні звіти"
      if (interaction.customId === "btn_show_recent") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const stmt = db.prepare(
          `SELECT * FROM reports ORDER BY id DESC LIMIT ?`
        );
        const rows = stmt.all(5);

        if (!rows.length) {
          return interaction.editReply({
            content: "Немає записів.",
          });
        }

        let out = rows
          .map((r) => {
            const created = new Date(r.created_at).toLocaleString("uk-UA");
            return `**№${r.id}** — ${r.full_name} (Static: ${r.static}) — ${created}`;
          })
          .join("\n");

        if (out.length > 2000) {
          out = out.substring(0, 1997) + "...";
        }

        await interaction.editReply({
          content: out,
        });

        return;
      }
    }

    // ========== ДИПЛОМ: Крок 2: Обробка даних після модалі ==========
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("diploma_modal_")
    ) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const name = interaction.fields.getTextInputValue("name").trim();
      const surname = interaction.fields.getTextInputValue("surname").trim();
      const gender =
        interaction.fields.getTextInputValue("gender")?.trim() || "";
      const issuedBy = interaction.fields.getTextInputValue("issued_by").trim();

      const fullName = `${surname} ${name}`;
      const outputFile = `diploma_${interaction.user.id}.png`;

      // --- Нумерація дипломів ---
      let diplomaNumber = 1;
      const counterFile = "./counter.json";

      try {
        if (fs.existsSync(counterFile)) {
          const data = JSON.parse(fs.readFileSync(counterFile, "utf-8"));
          diplomaNumber = data.lastNumber + 1;
        }
        fs.writeFileSync(
          counterFile,
          JSON.stringify({ lastNumber: diplomaNumber })
        );
      } catch (err) {
        console.error("❌ Помилка при оновленні лічильника:", err);
      }

      // Визначаємо тип диплома з customId
      const diplomaTypeMatch = interaction.customId.match(/diploma_modal_(.+)/);
      const diplomaType = diplomaTypeMatch ? diplomaTypeMatch[1] : "therapist";

      // Визначаємо шлях до шаблону на основі типу
      let templatePath = "";
      if (diplomaType === "therapist") {
        templatePath = "./assets/diploma-therapevt.png";
      } else if (diplomaType === "surgeon") {
        templatePath = "./assets/diploma-xiryrh.png";
      } else if (diplomaType === "specialist") {
        templatePath = "./assets/diploma-specialist.png";
      } else {
        templatePath = "./assets/diploma-therapevt.png"; // За замовчуванням
      }

      try {
        const template = await Canvas.loadImage(templatePath);
        const canvas = Canvas.createCanvas(template.width, template.height);
        const ctx = canvas.getContext("2d");

        // Фон
        ctx.drawImage(template, 0, 0);

        // Номер диплома (правий нижній кут)
        ctx.fillStyle = "#300f54";
        ctx.font = "24px Sans";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";

        const padding = 20;
        const lineSpacing = 28;

        ctx.fillText(
          `Диплом №${diplomaNumber}`,
          canvas.width - padding,
          canvas.height - padding - lineSpacing
        );

        // Дата видачі (правий нижній кут під номером диплому)
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
          canvas.width - padding,
          canvas.height - padding
        );
        ctx.fillStyle = "#300f54";
        ctx.font = "bold 48px Sans";
        ctx.textAlign = "left";
        ctx.fillText("Andrii Sage", 270, canvas.height - 180);

        ctx.font = "bold 48px Sans";
        ctx.textAlign = "center";
        ctx.fillText(issuedBy, canvas.width / 2 - 160, canvas.height - 180);

        // Текст — налаштуй координати під шаблон
        ctx.fillStyle = "#300f54";
        ctx.font = "56px LTDiploma";
        ctx.textAlign = "center";

        // Імʼя, Прізвище та Статіка
        ctx.textAlign = "center";
        ctx.fillStyle = "#300f54";

        // Основний шрифт для імені та прізвища
        ctx.font = " bold 56px LTDiploma";

        if (gender) {
          // Якщо вказано статік — виводимо ім'я та прізвище великим, а статік — меншим шрифтом на тому ж рівні
          const nameWidth = ctx.measureText(`${surname} ${name}`).width;
          const genderFontSize = 24; // у 2 рази менше
          ctx.font = `bold ${genderFontSize}px Sans`;

          const genderWidth = ctx.measureText(gender).width;
          const spacing = 80; // відстань між ім'ям та статіком
          const totalWidth = nameWidth + genderWidth + spacing;

          const startX = (canvas.width - totalWidth) / 2;
          const baseY = canvas.height / 2;

          // Прізвище + Ім'я
          ctx.font = "56px LTDiploma";
          ctx.fillText(
            `${surname} ${name}`,
            startX + nameWidth / 2,
            baseY + 90
          );

          // Статік
          ctx.font = `bold ${genderFontSize}px Sans`;
          ctx.fillText(
            gender,
            startX + nameWidth + spacing + genderWidth / 2,
            baseY + 80
          );
        } else {
          // Якщо статік не вказана — лише ім'я і прізвище по центру
          ctx.font = "56px LTDiploma";
          ctx.fillText(
            `${surname} ${name}`,
            canvas.width / 2,
            canvas.height / 2
          );
        }

        // Генерація файлу
        const buffer = canvas.toBuffer("image/png");
        fs.writeFileSync(outputFile, buffer);

        // Надсилання у канал
        const channel = await client.channels.fetch(
          process.env.TARGET_CHANNEL_ID
        );
        const attachment = new AttachmentBuilder(buffer, { name: outputFile });

        await channel.send({
          content: `🎓 **Диплом №${diplomaNumber}** — для **${fullName}**`,
          files: [attachment],
        });

        await interaction.editReply({
          content: "✅ Диплом згенеровано та відправлено у канал!",
        });

        fs.unlinkSync(outputFile); // видаляємо файл після відправки
      } catch (err) {
        console.error(err);
        await interaction.editReply({
          content: "❌ Помилка при створенні диплома.",
        });
      }
      return;
    }

    // ========== ТЕРАПІЯ: обробка модалі ==========
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "op_report_modal"
    ) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const fullName = interaction.fields.getTextInputValue("full_name").trim();
      const staticId = interaction.fields.getTextInputValue("static").trim();
      const operation = interaction.fields
        .getTextInputValue("operation")
        .trim();
      const description = interaction.fields
        .getTextInputValue("description")
        .trim();
      const issuedBy = interaction.fields.getTextInputValue("issued_by").trim();

      const now = new Date();
      const createdAt = now.toISOString();

      // запис у БД
      const insert = db.prepare(
        `INSERT INTO reports (full_name, static, operation, description, created_at, issued_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const info = insert.run(
        fullName,
        staticId,
        operation,
        description,
        createdAt,
        issuedBy
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
      ctx.font = "bold 48px Sans";
      ctx.textAlign = "left";
      ctx.fillText("Andrii Sage", 450, 1820);

      ctx.font = "bold 48px Sans";
      ctx.textAlign = "center";
      ctx.fillText(issuedBy, templateW / 2 - 250, 1820);

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

      const channel = await client.channels.fetch(
        process.env.REPORTS_CHANNEL_ID
      );

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

    // ========== ОБРОБКА МОДАЛІВ ДЛЯ ПОШУКУ ==========
    // Пошук по імені
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "search_name_modal"
    ) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const query = interaction.fields.getTextInputValue("query").trim();

      const stmt = db.prepare(
        `SELECT * FROM reports WHERE full_name LIKE ? ORDER BY id DESC LIMIT 50`
      );
      const rows = stmt.all(`%${query}%`);

      if (!rows.length) {
        return interaction.editReply({
          content: "❗ За запитом нічого не знайдено.",
        });
      }

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

      await interaction.editReply({
        content: content,
      });

      return;
    }

    // Пошук по Static
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "search_static_modal"
    ) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const query = interaction.fields.getTextInputValue("query").trim();

      const stmt = db.prepare(
        `SELECT * FROM reports WHERE static LIKE ? ORDER BY id DESC LIMIT 50`
      );
      const rows = stmt.all(`%${query}%`);

      if (!rows.length) {
        return interaction.editReply({
          content: "❗ За запитом нічого не знайдено.",
        });
      }

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

      await interaction.editReply({
        content: content,
      });

      return;
    }

    // Пошук по ID
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "search_id_modal"
    ) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const query = interaction.fields.getTextInputValue("query").trim();

      const stmt = db.prepare(`SELECT * FROM reports WHERE id = ?`);
      const result = stmt.get(Number(query));
      const rows = result ? [result] : [];

      if (!rows.length) {
        return interaction.editReply({
          content: "❗ За запитом нічого не знайдено.",
        });
      }

      const r = rows[0];
      const created = new Date(r.created_at).toLocaleString("uk-UA");
      const content = `**№${r.id}** — ${r.full_name} (Static: ${
        r.static
      }) — ${created}\nОперація: ${r.operation}\nОпис: ${
        r.description
      }\nВидано: ${r.issued_by || "Не вказано"}`;

      await interaction.editReply({
        content: content,
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
          flags: MessageFlags.Ephemeral,
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
