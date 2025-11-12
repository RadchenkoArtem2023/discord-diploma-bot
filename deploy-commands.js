import "dotenv/config";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";

const commands = [
  {
    name: "отримати_диплом",
    description: "Заповни форму, щоб отримати диплом (Прізвище/Імʼя/Стать).",
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("⏳ Реєструю команду...");
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );
    console.log("✅ Команду зареєстровано!");
  } catch (error) {
    console.error(error);
  }
})();
