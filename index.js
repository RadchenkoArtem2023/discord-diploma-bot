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

    try {
      const template = await Canvas.loadImage("./diploma_template.png");
      const canvas = Canvas.createCanvas(template.width, template.height);
      const ctx = canvas.getContext("2d");

      // Фон
      ctx.drawImage(template, 0, 0);

      // Текст — налаштуй координати під шаблон
      ctx.fillStyle = "#000";
      ctx.font = "bold 48px Sans";
      ctx.textAlign = "center";

      // Імʼя та прізвище
      ctx.fillText(fullName, canvas.width / 2, canvas.height / 2);

      // Стать (нижче)
      if (gender) {
        ctx.font = "32px Sans";
        ctx.fillText(gender, canvas.width / 2, canvas.height / 2 + 60);
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
        content: `🎓 Диплом для **${fullName}**`,
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
