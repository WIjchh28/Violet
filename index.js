require("dotenv").config();
const fs = require("fs");
const path = require("path");
const ffmpegStatic = require("ffmpeg-static");
if (ffmpegStatic) {
  process.env.FFMPEG_PATH = ffmpegStatic;
}

// Write PID for stop.bat process tracking
const pidFile = path.join(__dirname, ".bot.pid");
fs.writeFileSync(pidFile, process.pid.toString());

function cleanupPid() {
  try {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch {}
}

process.on("exit", cleanupPid);
process.on("SIGINT", () => {
  cleanupPid();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanupPid();
  process.exit(0);
});

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActivityType,
  Events,
} = require("discord.js");

const {
  slashCommands,
  handlePlay,
  handleSkip,
  handleStop,
  handleQuit,
  handlePause,
  handleResume,
  handleQueue,
  handleNowPlaying,
  handleLoop,
  handleShuffle,
  handleHelp,
  handleButtonInteraction,
} = require("./src/commands");

const PREFIX = process.env.PREFIX || "!";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Helper for replying to messages
function createMessageReplyFn(message) {
  let repliedMessage = null;
  return async (payload) => {
    if (!repliedMessage) {
      repliedMessage = await message
        .reply(payload)
        .catch(() => message.channel.send(payload));
      return repliedMessage;
    } else {
      return repliedMessage
        .edit(payload)
        .catch(() => message.channel.send(payload));
    }
  };
}

// Helper for replying to slash command interactions
function createInteractionReplyFn(interaction) {
  let hasReplied = false;
  return async (payload) => {
    if (!hasReplied && !interaction.replied && !interaction.deferred) {
      hasReplied = true;
      return interaction.reply(payload);
    } else {
      hasReplied = true;
      return interaction
        .editReply(payload)
        .catch(() => interaction.followUp(payload));
    }
  };
}

client.once(Events.ClientReady, async () => {
  console.log(`=======================================`);
  console.log(`🎵 Violet Music Bot Aktif!`);
  console.log(`🤖 Logged in as: ${client.user.tag}`);
  console.log(`🏰 Terhubung ke ${client.guilds.cache.size} server`);
  console.log(`=======================================`);

  // Set bot presence
  client.user.setActivity("Nemenin kamu ", {
    type: ActivityType.Listening,
  });

  // Register Slash Commands globally
  try {
    const rest = new REST({ version: "10" }).setToken(
      process.env.DISCORD_TOKEN,
    );
    console.log("🔄 Mendaftarkan application (slash) commands...");

    const commandsJson = slashCommands.map((cmd) => cmd.toJSON());
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commandsJson,
    });

    console.log("✅ Application (slash) commands berhasil didaftarkan!");
  } catch (err) {
    console.error("⚠️ Gagal mendaftarkan slash commands:", err.message);
  }
});

// Slash Commands & Buttons Handler
client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    try {
      await handleButtonInteraction(interaction);
    } catch (err) {
      console.error("Error handling button interaction:", err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, channel } = interaction;
  const replyFn = createInteractionReplyFn(interaction);

  try {
    switch (commandName) {
      case "play": {
        const query = interaction.options.getString("query", true);
        await handlePlay(channel, member, query, replyFn);
        break;
      }
      case "skip":
        handleSkip(member, replyFn);
        break;
      case "stop":
        handleStop(member, replyFn);
        break;
      case "quit":
        handleQuit(member, replyFn);
        break;
      case "pause":
        handlePause(member, replyFn);
        break;
      case "resume":
        handleResume(member, replyFn);
        break;
      case "queue":
        handleQueue(member, replyFn);
        break;
      case "nowplaying":
        handleNowPlaying(member, replyFn);
        break;
      case "loop":
        handleLoop(member, replyFn);
        break;
      case "shuffle":
        handleShuffle(member, replyFn);
        break;
      case "help":
        handleHelp(replyFn);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`Error in /${commandName}:`, err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `Terjadi kesalahan: ${err.message}`,
        ephemeral: true,
      });
    }
  }
});

// Prefix Commands Handler (e.g. !play, !skip, etc.)
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const replyFn = createMessageReplyFn(message);

  try {
    switch (command) {
      case "play":
      case "p": {
        const query = args.join(" ");
        if (!query) {
          return replyFn({
            content: `⚠️ Silakan berikan link Spotify atau judul lagu! Contoh:\n\`${PREFIX}play https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT\``,
          });
        }
        await handlePlay(message.channel, message.member, query, replyFn);
        break;
      }
      case "skip":
      case "s":
        handleSkip(message.member, replyFn);
        break;
      case "stop":
        handleStop(message.member, replyFn);
        break;
      case "quit":
      case "leave":
        handleQuit(message.member, replyFn);
        break;
      case "pause":
        handlePause(message.member, replyFn);
        break;
      case "resume":
        handleResume(message.member, replyFn);
        break;
      case "queue":
      case "q":
        handleQueue(message.member, replyFn);
        break;
      case "nowplaying":
      case "np":
        handleNowPlaying(message.member, replyFn);
        break;
      case "loop":
        handleLoop(message.member, replyFn);
        break;
      case "shuffle":
        handleShuffle(message.member, replyFn);
        break;
      case "help":
      case "h":
        handleHelp(replyFn);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`Error in ${PREFIX}${command}:`, err);
    replyFn({
      content: `Terjadi kesalahan saat memproses perintah: ${err.message}`,
    });
  }
});

// Prevent unhandled errors from terminating the bot process
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});

// Login with Discord Token from .env
client.login(process.env.DISCORD_TOKEN);
