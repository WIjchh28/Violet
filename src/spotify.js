const spotifyUrlInfo = require('spotify-url-info')(fetch);

/**
 * Format milliseconds to MM:SS or HH:MM:SS
 */
function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Check if the input is a Spotify URL
 */
function isSpotifyUrl(url) {
  if (typeof url !== 'string') return false;
  return /^(https?:\/\/)?(open\.spotify\.com|spotify\.link)\/.+$/i.test(url.trim());
}

/**
 * Resolve Spotify URLs (Tracks, Playlists, Albums, Episodes)
 */
async function resolveSpotify(inputUrl, requestedBy) {
  let url = inputUrl.trim();

  // Handle spotify.link redirects
  if (url.includes('spotify.link')) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      url = res.url || url;
    } catch {
      // fallback if HEAD fails
      const res = await fetch(url, { redirect: 'follow' });
      url = res.url || url;
    }
  }

  // Detect type
  const isPlaylist = /\/playlist\/([a-zA-Z0-9]+)/.test(url);
  const isAlbum = /\/album\/([a-zA-Z0-9]+)/.test(url);
  const isTrack = /\/track\/([a-zA-Z0-9]+)/.test(url);
  const isEpisode = /\/episode\/([a-zA-Z0-9]+)/.test(url);

  const defaultThumbnail = 'https://storage.googleapis.com/pr-newsroom-wp/1/2018/11/Spotify_Logo_RGB_Green.png';

  if (isTrack || isEpisode) {
    const data = await spotifyUrlInfo.getData(url);
    const artists = data.artists ? data.artists.map(a => a.name).join(', ') : '';
    const title = data.name || data.title || 'Unknown Title';
    const thumbnail = data.visualIdentity?.image?.[0]?.url || data.coverArt?.sources?.[0]?.url || defaultThumbnail;
    const duration = formatDuration(data.duration);
    const searchQuery = artists ? `ytsearch1:${title} ${artists}` : `ytsearch1:${title}`;

    return {
      type: 'track',
      tracks: [
        {
          title,
          artist: artists || 'Unknown Artist',
          url,
          thumbnail,
          duration,
          searchQuery,
          requestedBy,
          source: 'spotify',
        }
      ]
    };
  }

  if (isPlaylist || isAlbum) {
    const [meta, rawTracks] = await Promise.all([
      spotifyUrlInfo.getData(url).catch(() => null),
      spotifyUrlInfo.getTracks(url).catch(() => [])
    ]);

    const title = meta?.name || (isPlaylist ? 'Spotify Playlist' : 'Spotify Album');
    const thumbnail = meta?.visualIdentity?.image?.[0]?.url || defaultThumbnail;

    const tracks = rawTracks.map(t => {
      const tName = t.name || 'Unknown Track';
      const tArtist = t.artist || t.artists?.map(a => a.name).join(', ') || '';
      return {
        title: tName,
        artist: tArtist || 'Unknown Artist',
        url: t.uri ? `https://open.spotify.com/track/${t.uri.split(':').pop()}` : url,
        thumbnail,
        duration: formatDuration(t.duration),
        searchQuery: tArtist ? `ytsearch1:${tName} ${tArtist}` : `ytsearch1:${tName}`,
        requestedBy,
        source: 'spotify',
      };
    });

    return {
      type: isPlaylist ? 'playlist' : 'album',
      title,
      thumbnail,
      tracks
    };
  }

  // Fallback: try getData
  const data = await spotifyUrlInfo.getData(url);
  const title = data.name || data.title || 'Unknown Title';
  const artists = data.artists ? data.artists.map(a => a.name).join(', ') : '';
  const thumbnail = data.visualIdentity?.image?.[0]?.url || defaultThumbnail;
  const duration = formatDuration(data.duration);
  const searchQuery = artists ? `ytsearch1:${title} ${artists}` : `ytsearch1:${title}`;

  return {
    type: 'track',
    tracks: [
      {
        title,
        artist: artists || 'Unknown Artist',
        url,
        thumbnail,
        duration,
        searchQuery,
        requestedBy,
        source: 'spotify',
      }
    ]
  };
}

module.exports = {
  isSpotifyUrl,
  resolveSpotify,
  formatDuration
};
