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
} from "discord.js";
import Canvas from "canvas";
import fs from "fs";
import path from "path";

// Підключення власного шрифту
Canvas.registerFont(path.resolve("./LTDiploma.otf"), { family: "LTDiploma" });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`✅ Увійшов як ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // --- Крок 1: Відображення модалі ---
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "отримати_диплом") {
      const modal = new ModalBuilder()
        .setCustomId("diploma_modal")
        .setTitle("Отримати диплом");

      const surnameInput = new TextInputBuilder()
        .setCustomId("surname")
        .setLabel("Прізвище")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Наприклад: Петренко")
        .setRequired(true);

      const nameInput = new TextInputBuilder()
        .setCustomId("name")
        .setLabel("Імʼя")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Наприклад: Іван")
        .setRequired(true);

      const genderInput = new TextInputBuilder()
        .setCustomId("gender")
        .setLabel("Статік (необовʼязково)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Наприклад: 1111")
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(surnameInput),
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(genderInput)
      );

      await interaction.showModal(modal);
    }
  }

  // --- Крок 2: Обробка даних після модалі ---
  if (interaction.isModalSubmit() && interaction.customId === "diploma_modal") {
    await interaction.deferReply({ ephemeral: true });

    const surname = interaction.fields.getTextInputValue("surname").trim();
    const name = interaction.fields.getTextInputValue("name").trim();
    const gender = interaction.fields.getTextInputValue("gender")?.trim() || "";

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

    try {
      const template = await Canvas.loadImage("./diploma_template.png");
      const canvas = Canvas.createCanvas(template.width, template.height);
      const ctx = canvas.getContext("2d");

      // Фон
      ctx.drawImage(template, 0, 0);

      // Номер диплома (лівий нижній кут)
      ctx.fillStyle = "#000";
      ctx.font = "bold 28px Sans";
      ctx.textAlign = "left";
      ctx.fillText(`Диплом №${diplomaNumber}`, 500, canvas.height - 160);

      // Дата видачі (внизу по центру)
      const currentDate = new Date();
      const formattedDate = currentDate.toLocaleDateString("uk-UA", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      ctx.fillStyle = "#000";
      ctx.font = "bold 28px Sans";
      ctx.textAlign = "center";
      ctx.fillText(
        `Дата видачі: ${formattedDate}`,
        canvas.width / 2,
        canvas.height - 160
      );

      // Текст — налаштуй координати під шаблон
      ctx.fillStyle = "#000";
      ctx.font = "48px LTDiploma";
      ctx.textAlign = "center";

      // Імʼя, Прізвище та Статіка
      ctx.textAlign = "center";
      ctx.fillStyle = "#000";

      // Основний шрифт для імені та прізвища
      ctx.font = " bold 48px LTDiploma";

      if (gender) {
        // Якщо вказано статік — виводимо ім’я та прізвище великим, а статік — меншим шрифтом на тому ж рівні
        const nameWidth = ctx.measureText(`${surname} ${name}`).width;
        const genderFontSize = 24; // у 2 рази менше
        ctx.font = `bold ${genderFontSize}px Sans`;

        const genderWidth = ctx.measureText(gender).width;
        const totalWidth = nameWidth + genderWidth + 40; // 40px проміжок між ними

        const startX = (canvas.width - totalWidth) / 2;
        const baseY = canvas.height / 2;

        // Прізвище + Ім’я
        ctx.font = "48px LTDiploma";
        ctx.fillText(`${surname} ${name}`, startX + nameWidth / 2, baseY + 40);

        // Статік
        ctx.font = `bold ${genderFontSize}px Sans`;
        ctx.fillText(
          gender,
          startX + nameWidth + genderWidth / 2 + 40,
          baseY + 40
        );
      } else {
        // Якщо статік не вказана — лише ім’я і прізвище по центру
        ctx.font = "48px LTDiploma";
        ctx.fillText(`${surname} ${name}`, canvas.width / 2, canvas.height / 2);
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
  }
});

client.login(process.env.TOKEN);
