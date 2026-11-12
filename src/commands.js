const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { execFile } = require("child_process");
const path = require("path");
const { isSpotifyUrl, resolveSpotify, formatDuration } = require("./spotify");
const { queueManager } = require("./player");

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
  return localBin;
}

function parseYtDlpJson(stdout) {
  const lines = stdout.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // continue
      }
    }
  }
  return JSON.parse(stdout);
}

function resolveYouTubeOrSearch(query, requestedBy) {
  return new Promise((resolve, reject) => {
    const ytDlpPath = getYtDlpPath();
    const target = query.startsWith("http") ? query : `ytsearch1:${query}`;

    execFile(
      ytDlpPath,
      ["--dump-json", "--no-playlist", "--quiet", "--no-warnings", target],
      (err, stdout) => {
        if (err) {
          return reject(
            new Error("Gagal menemukan lagu dari pencarian tersebut."),
          );
        }
        try {
          const info = parseYtDlpJson(stdout);
          const duration =
            info.duration_string ||
            (info.duration ? formatDuration(info.duration * 1000) : "N/A");
          resolve({
            title: info.title || "Unknown Title",
            artist: info.uploader || info.channel || "YouTube",
            url: info.webpage_url || query,
            thumbnail: info.thumbnail || null,
            duration,
            searchQuery: info.webpage_url || query,
            requestedBy,
            source: "youtube",
          });
        } catch (e) {
          reject(new Error("Format data tidak sesuai dari penyedia audio."));
        }
      },
    );
  });
}

// Slash command builders for registration
const slashCommands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription(
      "Putar lagu dari link Spotify, YouTube, atau kata kunci pencarian",
    )
    .addStringOption((opt) =>
      opt
        .setName("query")
        .setDescription(
          "Link Spotify (Track/Album/Playlist), YouTube, atau judul lagu",
        )
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Lewati lagu yang sedang diputar"),
  new SlashCommandBuilder()
    .setName("stop")
    .setDescription(
      "Hentikan musik, hapus antrean, dan keluar dari voice channel",
    ),
  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Jeda lagu yang sedang diputar"),
  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Lanjutkan pemutaran lagu yang dijeda"),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Lihat daftar antrean lagu"),
  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Lihat informasi lagu yang sedang diputar saat ini"),
  new SlashCommandBuilder()
    .setName("loop")
    .setDescription(
      "Ganti mode loop (Mati / Ulangi Lagu / Ulangi Seluruh Antrean)",
    ),
  new SlashCommandBuilder()
    .setName("quit")
    .setDescription("Keluarkan bot dari voice channel dan bersihkan antrean"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Lihat panduan penggunaan bot musik Violet"),
  new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("Acak urutan lagu dalam antrean"),
];

/**
 * Handle Play command logic (shared between prefix and slash)
 */
async function handlePlay(channel, member, query, replyFn) {
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) {
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF5555")
          .setDescription(
            "⚠️ Anda harus masuk ke **Voice Channel** terlebih dahulu untuk memutar musik!",
          ),
      ],
      ephemeral: true,
    });
  }

  // Initial loading response
  await replyFn({
    embeds: [
      new EmbedBuilder()
        .setColor("#1DB954")
        .setDescription(`🔍 Memproses: **${query}**...`),
    ],
  });

  const queue = queueManager.getOrCreate(voiceChannel.guild.id, member.client);
  queue.connect(voiceChannel, channel);

  try {
    if (isSpotifyUrl(query)) {
      const spotifyData = await resolveSpotify(query, member.user);

      if (spotifyData.type === "track") {
        const track = spotifyData.tracks[0];
        const isFirst = queue.songs.length === 0 && !queue.isPlaying;
        queue.addTrack(track);

        if (!isFirst) {
          return replyFn({
            embeds: [
              new EmbedBuilder()
                .setColor("#1DB954")
                .setAuthor({
                  name: "Ditambahkan ke Antrean (Spotify)",
                  iconURL:
                    "https://storage.googleapis.com/pr-newsroom-wp/1/2018/11/Spotify_Logo_RGB_Green.png",
                })
                .setDescription(
                  `**[${track.title}](${track.url})**\nArtis: **${track.artist}**`,
                )
                .addFields(
                  { name: "⏱️ Durasi", value: track.duration, inline: true },
                  {
                    name: "👤 Peminta",
                    value: member.user.toString(),
                    inline: true,
                  },
                  {
                    name: "🔢 Posisi Antrean",
                    value: `#${queue.songs.length}`,
                    inline: true,
                  },
                )
                .setThumbnail(track.thumbnail),
            ],
          });
        }
      } else {
        // Playlist or Album
        queue.addTracks(spotifyData.tracks);

        return replyFn({
          embeds: [
            new EmbedBuilder()
              .setColor("#1DB954")
              .setAuthor({
                name: `Ditambahkan dari Spotify (${spotifyData.type === "playlist" ? "Playlist" : "Album"})`,
                iconURL:
                  "https://storage.googleapis.com/pr-newsroom-wp/1/2018/11/Spotify_Logo_RGB_Green.png",
              })
              .setTitle(spotifyData.title)
              .setDescription(
                `Berhasil menambahkan **${spotifyData.tracks.length} lagu** ke dalam antrean!`,
              )
              .setThumbnail(spotifyData.thumbnail)
              .setFooter({ text: `Diminta oleh ${member.user.tag}` }),
          ],
        });
      }
    } else {
      // Search or direct link
      const track = await resolveYouTubeOrSearch(query, member.user);
      const isFirst = queue.songs.length === 0 && !queue.isPlaying;
      queue.addTrack(track);

      if (!isFirst) {
        return replyFn({
          embeds: [
            new EmbedBuilder()
              .setColor("#3388FF")
              .setAuthor({ name: "Ditambahkan ke Antrean" })
              .setDescription(
                `**[${track.title}](${track.url})**\nArtis/Channel: **${track.artist}**`,
              )
              .addFields(
                { name: "⏱️ Durasi", value: track.duration, inline: true },
                {
                  name: "👤 Peminta",
                  value: member.user.toString(),
                  inline: true,
                },
                {
                  name: "🔢 Posisi Antrean",
                  value: `#${queue.songs.length}`,
                  inline: true,
                },
              )
              .setThumbnail(track.thumbnail),
          ],
        });
      }
    }
  } catch (err) {
    console.error("Error handling play:", err);
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF3333")
          .setDescription(`❌ Gagal memuat lagu: ${err.message}`),
      ],
    });
  }
}

/**
 * Handle Skip command
 */
function handleSkip(member, replyFn) {
  const queue = queueManager.get(member.guild.id);
  if (!queue || !queue.isPlaying) {
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF5555")
          .setDescription("⚠️ Tidak ada lagu yang sedang diputar saat ini."),
      ],
      ephemeral: true,
    });
  }

  const currentTitle = queue.current ? queue.current.title : "Lagu";
  queue.skip();
  return replyFn({
    embeds: [
      new EmbedBuilder()
        .setColor("#1DB954")
        .setDescription(`⏭️ Melewati lagu **${currentTitle}**.`),
    ],
  });
}

/**
 * Handle Stop command
 */
function handleStop(member, replyFn) {
  const queue = queueManager.get(member.guild.id);
  if (!queue) {
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF5555")
          .setDescription("⚠️ Bot tidak sedang memutar lagu di server ini."),
      ],
      ephemeral: true,
    });
  }

  queue.stop();
  return replyFn({
    embeds: [
      new EmbedBuilder()
        .setColor("#FF3333")
        .setDescription(
          "⏹️ Musik dihentikan, antrean dikosongkan, dan bot keluar dari voice channel.",
        ),
    ],
  });
}

/**
 * Handle Pause command
 */
function handlePause(member, replyFn) {
  const queue = queueManager.get(member.guild.id);
  if (!queue || !queue.isPlaying) {
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF5555")
          .setDescription("⚠️ Tidak ada lagu yang sedang diputar."),
      ],
      ephemeral: true,
    });
  }

  if (queue.isPaused) {
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FFAA00")
          .setDescription("⏸️ Musik sudah dalam keadaan dijeda."),
      ],
      ephemeral: true,
    });
  }

  queue.pause();
  return replyFn({
    embeds: [
      new EmbedBuilder()
        .setColor("#FFAA00")
        .setDescription(
          "⏸️ Lagu telah dijeda. Gunakan `/resume` atau `!resume` untuk melanjutkan.",
        ),
    ],
  });
}

/**
 * Handle Resume command
 */
function handleResume(member, replyFn) {
  const queue = queueManager.get(member.guild.id);
  if (!queue || !queue.isPlaying) {
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF5555")
          .setDescription("⚠️ Tidak ada lagu yang sedang diputar."),
      ],
      ephemeral: true,
    });
  }

  if (!queue.isPaused) {
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FFAA00")
          .setDescription("▶️ Musik sedang berjalan (tidak dijeda)."),
      ],
      ephemeral: true,
    });
  }

  queue.resume();
  return replyFn({
    embeds: [
      new EmbedBuilder()
        .setColor("#1DB954")
        .setDescription("▶️ Lagu dilanjutkan."),
    ],
  });
}

/**
 * Helper to safely format a track string for queue display without exceeding field limits
 */
function formatQueueTrack(s, index) {
  const requestedByStr =
    s.requestedBy?.toString?.() || s.requestedBy || "Pengguna";
  const durationStr = s.duration ? ` \`[${s.duration}]\`` : "";

  let title = (s.title || "Unknown Title").replace(/[\[\]]/g, "");
  if (title.length > 45) {
    title = title.substring(0, 42) + "...";
  }

  let artist = (s.artist || "Unknown Artist").replace(/[\[\]]/g, "");
  if (artist.length > 25) {
    artist = artist.substring(0, 22) + "...";
  }

  const trackLink = s.url ? `[${title}](${s.url})` : title;
  return `**${index}.** ${trackLink} - ${artist}${durationStr} | Diminta: ${requestedByStr}`;
}

/**
 * Handle Queue command
 */
async function handleQueue(member, replyFn) {
  try {
    const queue = queueManager.get(member.guild.id);
    if (
      !queue ||
      (!queue.current && (!queue.songs || queue.songs.length === 0))
    ) {
      return await replyFn({
        embeds: [
          new EmbedBuilder()
            .setColor("#888888")
            .setDescription("📭 Antrean lagu kosong saat ini."),
        ],
      });
    }

    const embed = new EmbedBuilder()
      .setColor("#1DB954")
      .setTitle(`📜 Antrean Musik - ${member.guild.name}`)
      .setTimestamp();

    if (queue.current) {
      const requestedByStr =
        queue.current.requestedBy?.toString?.() ||
        queue.current.requestedBy ||
        "Pengguna";
      let currentTitle = (queue.current.title || "Unknown Title").replace(
        /[\[\]]/g,
        "",
      );
      if (currentTitle.length > 60)
        currentTitle = currentTitle.substring(0, 57) + "...";

      let currentArtist = (queue.current.artist || "Unknown Artist").replace(
        /[\[\]]/g,
        "",
      );
      if (currentArtist.length > 40)
        currentArtist = currentArtist.substring(0, 37) + "...";

      const currentUrl = queue.current.url
        ? `**[${currentTitle}](${queue.current.url})**`
        : `**${currentTitle}**`;
      const currentDuration = queue.current.duration
        ? `\`[${queue.current.duration}]\``
        : "";

      embed.addFields({
        name: "🎶 Sedang Diputar",
        value: `${currentUrl} - ${currentArtist} ${currentDuration}\nDiminta oleh: ${requestedByStr}`,
      });
    }

    if (queue.songs && queue.songs.length > 0) {
      let list = "";
      let displayedCount = 0;

      for (let i = 0; i < queue.songs.length; i++) {
        const song = queue.songs[i];
        if (!song) continue;

        const line = formatQueueTrack(song, i + 1);
        const remaining = queue.songs.length - (i + 1);
        const extraPreview =
          remaining > 0 ? `\n\n*...dan ${remaining} lagu lainnya.*` : "";

        // Check if adding this line exceeds the 1024 characters limit for embed field values
        if (
          (list + (list ? "\n\n" : "") + line + extraPreview).length > 1000 ||
          displayedCount >= 10
        ) {
          break;
        }

        list += (list ? "\n\n" : "") + line;
        displayedCount++;
      }

      const remainingCount = queue.songs.length - displayedCount;
      const extra =
        remainingCount > 0
          ? `\n\n*...dan ${remainingCount} lagu lainnya.*`
          : "";
      const fieldValue =
        (list + extra).substring(0, 1024) ||
        "Tidak ada lagu berikutnya dalam antrean.";

      embed.addFields({
        name: `📋 Antrean Berikutnya (${queue.songs.length} lagu)`,
        value: fieldValue,
      });
    } else {
      embed.addFields({
        name: "📋 Antrean Berikutnya",
        value: "Tidak ada lagu berikutnya dalam antrean.",
      });
    }

    embed.setFooter({
      text: `Mode Loop: ${(queue.loop || "off").toUpperCase()}`,
    });
    return await replyFn({ embeds: [embed] });
  } catch (err) {
    console.error("Error in handleQueue:", err);
    return await replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF5555")
          .setDescription("⚠️ Terjadi kesalahan saat menampilkan antrean."),
      ],
    });
  }
}

/**
 * Handle NowPlaying command
 */
function handleNowPlaying(member, replyFn) {
  const queue = queueManager.get(member.guild.id);
  if (!queue || !queue.current) {
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#888888")
          .setDescription("📭 Tidak ada lagu yang sedang diputar."),
      ],
    });
  }

  const embed = queue.createNowPlayingEmbed(queue.current);
  const row = queue.createControlRow();
  return replyFn({ embeds: [embed], components: row });
}

/**
 * Handle Loop command
 */
function handleLoop(member, replyFn) {
  const queue = queueManager.get(member.guild.id);
  if (!queue) {
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF5555")
          .setDescription("⚠️ Bot tidak sedang aktif di server ini."),
      ],
      ephemeral: true,
    });
  }

  const newMode = queue.toggleLoop();
  let desc = "🔁 Mode loop dinonaktifkan.";
  if (newMode === "track")
    desc = "🔂 Mode loop diaktifkan untuk **lagu saat ini**.";
  if (newMode === "queue")
    desc = "🔁 Mode loop diaktifkan untuk **seluruh antrean**.";

  return replyFn({
    embeds: [new EmbedBuilder().setColor("#1DB954").setDescription(desc)],
  });
}

/**
 * Handle Quit command (leave voice channel)
 */
function handleQuit(member, replyFn) {
  const queue = queueManager.get(member.guild.id);
  if (!queue || !queue.connection) {
    return replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF5555")
          .setDescription("⚠️ Bot tidak sedang berada di dalam voice channel."),
      ],
      ephemeral: true,
    });
  }

  queue.stop();
  return replyFn({
    embeds: [
      new EmbedBuilder()
        .setColor("#1DB954")
        .setDescription("👋 **Violet** telah keluar dari voice channel."),
    ],
  });
}

async function handleShuffle(member, replyFn) {
  try {
    const queue = queueManager.get(member.guild.id);
    if (!queue || !queue.songs || queue.songs.length <= 1) {
      return await replyFn({
        embeds: [
          new EmbedBuilder()
            .setColor("#FF5555")
            .setDescription(
              "⚠️ Antrean kosong atau hanya 1 lagu. Tidak ada yang diacak.",
            ),
        ],
        ephemeral: true,
      });
    }
    queue.shuffle();
    return await replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#1DB954")
          .setDescription(
            `🔀 Antrean berhasil diacak! **${queue.songs.length} lagu** dengan urutan baru.`,
          ),
      ],
    });
  } catch (err) {
    console.error("Error in handleShuffle:", err);
    return await replyFn({
      embeds: [
        new EmbedBuilder()
          .setColor("#FF5555")
          .setDescription("⚠️ Terjadi kesalahan saat mengacak antrean."),
      ],
      ephemeral: true,
    });
  }
}

/**
 * Handle Help command
 */
function handleHelp(replyFn) {
  const embed = new EmbedBuilder()
    .setColor("#1DB954")
    .setTitle("🎵 Panduan Penggunaan Violet Music Bot")
    .setDescription(
      "Bot ini mendukung pemutaran lagu langsung menggunakan **link Spotify** (Lagu, Playlist, Album) serta YouTube dan pencarian kata kunci!",
    )
    .addFields(
      {
        name: "🟢 Perintah Pemutaran (Spotify & Lainnya)",
        value:
          "• `/play <link/judul>` atau `!play <link/judul>` - Memutar lagu/playlist Spotify atau mencari lagu\n" +
          "• `/skip` atau `!skip` - Lewati lagu saat ini\n" +
          "• `/stop` atau `!stop` - Hentikan musik dan bot keluar voice channel\n" +
          "• `/quit` atau `!quit` (alias: `!leave`) - Keluarkan bot dari voice channel\n" +
          "• `/pause` atau `!pause` - Jeda pemutaran musik\n" +
          "• `/resume` atau `!resume` - Lanjutkan pemutaran musik\n" +
          "• `/queue` atau `!queue` (alias: `!q`) - Lihat daftar antrean lagu\n" +
          "• `/nowplaying` atau `!np` - Cek lagu yang sedang diputar dengan tombol interaktif\n" +
          "• `/loop` atau `!loop` - Ganti mode pengulangan (Off / Track / Queue)\n" +
          "• `/shuffle` atau `!shuffle` - Acak urutan lagu dalam antrean\n" +
          "• `/help` atau `!help` - Tampilkan pesan bantuan ini",
      },
      {
        name: "💡 Contoh Penggunaan Link Spotify",
        value:
          "• **Track Spotify:** `!play https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT`\n" +
          "• **Playlist Spotify:** `!play https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M`\n" +
          "• **Album Spotify:** `!play https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa`\n" +
          "• **Judul Biasa:** `!play Lathi Weird Genius`",
      },
    )
    .setFooter({
      text: "Violet Music • Dibuat untuk Discord",
      iconURL:
        "https://storage.googleapis.com/pr-newsroom-wp/1/2018/11/Spotify_Logo_RGB_Green.png",
    })
    .setTimestamp();

  return replyFn({ embeds: [embed] });
}

/**
 * Handle button interactions from NowPlaying embed
 */
async function handleButtonInteraction(interaction) {
  const member = interaction.member;
  const queue = queueManager.get(interaction.guildId);

  if (!queue) {
    return interaction.reply({
      content: "Antrean musik sudah tidak aktif.",
      ephemeral: true,
    });
  }

  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel || voiceChannel.id !== queue.voiceChannel?.id) {
    return interaction.reply({
      content:
        "Anda harus berada di voice channel yang sama dengan bot untuk menggunakan tombol ini.",
      ephemeral: true,
    });
  }

  const id = interaction.customId;

  if (id === "btn_toggle_pause") {
    if (queue.isPaused) {
      queue.resume();
      await interaction.update({ components: queue.createControlRow() });
      await interaction.followUp({
        content: "▶️ Dilanjutkan.",
        ephemeral: true,
      });
    } else {
      queue.pause();
      await interaction.update({ components: queue.createControlRow() });
      await interaction.followUp({ content: "⏸️ Dijeda.", ephemeral: true });
    }
  } else if (id === "btn_skip") {
    queue.skip();
    await interaction.reply({
      content: "⏭️ Melewati lagu...",
      ephemeral: true,
    });
  } else if (id === "btn_stop") {
    queue.stop();
    await interaction.reply({
      content: "⏹️ Musik dihentikan.",
      ephemeral: true,
    });
  } else if (id === "btn_loop") {
    const mode = queue.toggleLoop();
    await interaction.update({ components: queue.createControlRow() });
    await interaction.followUp({
      content: `🔁 Mode loop: ${mode.toUpperCase()}`,
      ephemeral: true,
    });
  } else if (id === "btn_shuffle") {
    if (queue.songs.length <= 1) {
      await interaction.reply({
        content: "⚠️ Antrean kosong atau hanya 1 lagu. Tidak ada yang diacak.",
        ephemeral: true,
      });
    } else {
      queue.shuffle();
      await interaction.reply({
        content: `🔀 Antrean berhasil diacak! **${queue.songs.length} lagu** dengan urutan baru.`,
        ephemeral: true,
      });
    }
  } else if (id === "btn_queue") {
    try {
      await handleQueue(member, async (data) => {
        if (interaction.replied || interaction.deferred) {
          return interaction.followUp({ ...data, ephemeral: true });
        }
        return interaction.reply({ ...data, ephemeral: true });
      });
    } catch (err) {
      console.error("Error in btn_queue:", err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "⚠️ Terjadi kesalahan saat menampilkan antrean.",
          ephemeral: true,
        });
      }
    }
  }
}

module.exports = {
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
};
