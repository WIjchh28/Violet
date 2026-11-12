const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require("@discordjs/voice");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const ffmpegStatic = require("ffmpeg-static");

// Ensure FFmpeg is available for @discordjs/voice
if (ffmpegStatic) {
  process.env.FFMPEG_PATH = ffmpegStatic;
}

function getYtDlpPath() {
  const localBin = path.join(
    __dirname,
    "..",
    "node_modules",
    "@distube",
    "yt-dlp",
    "bin",
    process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
  );
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return "yt-dlp";
}

class GuildQueue {
  constructor(guildId, client) {
    this.guildId = guildId;
    this.client = client;
    this.voiceChannel = null;
    this.textChannel = null;
    this.connection = null;
    this.player = createAudioPlayer();
    this.songs = [];
    this.current = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.loop = "off"; // 'off' | 'track' | 'queue'
    this.volume = 1.0;
    this.currentProcess = null;
    this.disconnectTimeout = null;
    this.lastNowPlayingMessage = null;

    // Attach player listeners
    this.player.on(AudioPlayerStatus.Idle, () => {
      this.handleSongEnd();
    });

    this.player.on("error", (error) => {
      console.error(`[Player Error] Guild ${this.guildId}:`, error.message);
      if (this.textChannel) {
        this.textChannel
          .send({
            embeds: [
              new EmbedBuilder()
                .setColor("#FF3333")
                .setDescription(
                  `⚠️ **Gagal memutar lagu:** ${error.message}. Melanjutkan ke antrean berikutnya...`,
                ),
            ],
          })
          .catch(() => {});
      }
      this.handleSongEnd();
    });
  }

  connect(voiceChannel, textChannel) {
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;

    if (
      !this.connection ||
      this.connection.state.status === VoiceConnectionStatus.Destroyed
    ) {
      this.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

      this.connection.subscribe(this.player);

      this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(
              this.connection,
              VoiceConnectionStatus.Signalling,
              5_000,
            ),
            entersState(
              this.connection,
              VoiceConnectionStatus.Connecting,
              5_000,
            ),
          ]);
        } catch {
          this.destroy();
        }
      });
    }

    // Cancel idle timeout if reconnected
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }
  }

  addTrack(track) {
    this.songs.push(track);
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  addTracks(tracks) {
    this.songs.push(...tracks);
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  async playNext() {
    if (this.songs.length === 0) {
      this.current = null;
      this.isPlaying = false;
      this.isPaused = false;

      // Set idle disconnect timeout (3 minutes)
      if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = setTimeout(() => {
        if (this.songs.length === 0 && !this.isPlaying) {
          if (this.textChannel) {
            this.textChannel
              .send({
                embeds: [
                  new EmbedBuilder()
                    .setColor("#888888")
                    .setDescription(
                      "👋 Keluar dari voice channel karena tidak ada aktivitas selama 5 menit.",
                    ),
                ],
              })
              .catch(() => {});
          }
          this.destroy();
        }
      }, 600_000);

      return;
    }

    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }

    const song = this.songs.shift();
    this.current = song;
    this.isPlaying = true;
    this.isPaused = false;

    this.killCurrentProcess();

    try {
      const ytDlpPath = getYtDlpPath();
      const query = song.searchQuery || song.url;

      // Spawn yt-dlp to stream audio
      const proc = spawn(
        ytDlpPath,
        [
          "-o",
          "-",
          "-f",
          "ba/b",
          "--no-playlist",
          "--quiet",
          "--no-warnings",
          query,
        ],
        {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        },
      );

      this.currentProcess = proc;

      proc.on("error", (err) => {
        console.error("[yt-dlp spawn error]:", err);
        this.handleSongEnd();
      });

      const resource = createAudioResource(proc.stdout, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
      });

      if (resource.volume) {
        resource.volume.setVolume(this.volume);
      }

      this.player.play(resource);

      // Send Now Playing embed with interactive control buttons
      if (this.textChannel) {
        const embed = this.createNowPlayingEmbed(song);
        const row = this.createControlRow();

        const msg = await this.textChannel
          .send({
            embeds: [embed],
            components: row,
          })
          .catch(() => null);

        this.lastNowPlayingMessage = msg;
      }
    } catch (err) {
      console.error("[Playback start error]:", err);
      if (this.textChannel) {
        this.textChannel
          .send({
            embeds: [
              new EmbedBuilder()
                .setColor("#FF3333")
                .setDescription(
                  `❌ Gagal memutar **${song.title}**: ${err.message}`,
                ),
            ],
          })
          .catch(() => {});
      }
      this.handleSongEnd();
    }
  }

  handleSongEnd() {
    this.killCurrentProcess();

    if (this.loop === "track" && this.current) {
      this.songs.unshift(this.current);
    } else if (this.loop === "queue" && this.current) {
      this.songs.push(this.current);
    }

    this.playNext();
  }

  killCurrentProcess() {
    if (this.currentProcess) {
      try {
        this.currentProcess.stdout.destroy();
        this.currentProcess.kill("SIGTERM");
      } catch {
        // ignore
      }
      this.currentProcess = null;
    }
  }

  skip() {
    if (!this.isPlaying) return false;
    this.killCurrentProcess();
    this.player.stop(true);
    return true;
  }

  pause() {
    if (!this.isPlaying || this.isPaused) return false;
    this.player.pause();
    this.isPaused = true;
    return true;
  }

  resume() {
    if (!this.isPlaying || !this.isPaused) return false;
    this.player.unpause();
    this.isPaused = false;
    return true;
  }

  stop() {
    this.songs = [];
    this.current = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.killCurrentProcess();
    this.player.stop(true);
    this.destroy();
    return true;
  }

  shuffle() {
    if (this.songs.length <= 1) return false;
    for (let i = this.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
    }
    return true;
  }

  toggleLoop() {
    if (this.loop === "off") {
      this.loop = "track";
    } else if (this.loop === "track") {
      this.loop = "queue";
    } else {
      this.loop = "off";
    }
    return this.loop;
  }

  destroy() {
    this.killCurrentProcess();
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }
    if (this.connection) {
      try {
        this.connection.destroy();
      } catch {
        // ignore
      }
      this.connection = null;
    }
    this.isPlaying = false;
    this.isPaused = false;
    this.songs = [];
    this.current = null;
    queueManager.delete(this.guildId);
  }

  createNowPlayingEmbed(song) {
    const embed = new EmbedBuilder()
      .setColor("#1DB954") // Spotify Green
      .setTitle("🎶 Sedang Memutar Musik")
      .setDescription(
        `**[${song.title}](${song.url})**\nArtis: **${song.artist}**`,
      )
      .addFields(
        { name: "⏱️ Durasi", value: song.duration || "N/A", inline: true },
        {
          name: "👤 Diminta oleh",
          value: song.requestedBy?.toString() || "Pengguna",
          inline: true,
        },
        { name: "🔁 Loop Mode", value: this.loop.toUpperCase(), inline: true },
      )
      .setFooter({
        text: "Violet Music • Spotify & YouTube Support",
        iconURL:
          "https://storage.googleapis.com/pr-newsroom-wp/1/2018/11/Spotify_Logo_RGB_Green.png",
      })
      .setTimestamp();

    if (song.thumbnail) {
      embed.setThumbnail(song.thumbnail);
    }

    return embed;
  }

  createControlRow() {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("btn_toggle_pause")
        .setLabel(this.isPaused ? "Lanjutkan" : "Jeda")
        .setEmoji(this.isPaused ? "▶️" : "⏸️")
        .setStyle(this.isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("btn_skip")
        .setLabel("Lewati")
        .setEmoji("⏭️")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("btn_loop")
        .setLabel(`Loop: ${this.loop}`)
        .setEmoji("🔁")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("btn_shuffle")
        .setLabel("Acak")
        .setEmoji("🔀")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("btn_stop")
        .setLabel("Berhenti")
        .setEmoji("⏹️")
        .setStyle(ButtonStyle.Danger),
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("btn_queue")
        .setLabel("Antrean")
        .setEmoji("📜")
        .setStyle(ButtonStyle.Secondary),
    );

    return [row1, row2];
  }
}

// Global queue manager mapping guildId -> GuildQueue
const queues = new Map();

const queueManager = {
  get(guildId) {
    return queues.get(guildId);
  },
  getOrCreate(guildId, client) {
    let q = queues.get(guildId);
    if (!q) {
      q = new GuildQueue(guildId, client);
      queues.set(guildId, q);
    }
    return q;
  },
  delete(guildId) {
    queues.delete(guildId);
  },
};

module.exports = {
  GuildQueue,
  queueManager,
};
