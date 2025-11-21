import "dotenv/config";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";

const commands = [
  // ----------- ДИПЛОМ ----------------
  {
    name: "отримати_диплом",
    description: "Заповни форму, щоб отримати диплом (Прізвище/Імʼя/Стать).",
  },

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
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
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
  } catch (error) {
    console.error("❌ Помилка реєстрації:", error);
  }
})();
