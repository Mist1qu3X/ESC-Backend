/**
 * live-stream lifecycles
 *
 * Auto-pull the broadcast title from YouTube (oEmbed, no API key) when the admin
 * leaves `title` blank. oEmbed returns the video's real title for a known video
 * id; server-side fetch = no CORS. Failures are swallowed so a save never breaks.
 */

// videoId из разных форм YouTube-ссылки (watch / youtu.be / live / embed / shorts)
function ytId(url: string): string | null {
  const m = String(url || '').match(
    /(?:youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

async function fetchYouTubeTitle(url: string): Promise<string | null> {
  const id = ytId(url);
  if (!id) return null; // канал без конкретного видео — oEmbed не поможет, оставляем ручной title
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const endpoint =
      'https://www.youtube.com/oembed?url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + id) +
      '&format=json';
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return null;
    const data: any = await res.json();
    return typeof data?.title === 'string' && data.title.trim() ? data.title.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const isBlank = (v: unknown) => !String(v ?? '').trim();

export default {
  async beforeCreate(event: any) {
    const data = event?.params?.data;
    if (data?.url && isBlank(data.title)) {
      const title = await fetchYouTubeTitle(data.url);
      if (title) data.title = title;
    }
  },

  // On update `data` holds only changed fields. Auto-fill when a url is (re)set
  // and the title is explicitly left blank in this same payload.
  async beforeUpdate(event: any) {
    const data = event?.params?.data;
    if (data?.url && 'title' in data && isBlank(data.title)) {
      const title = await fetchYouTubeTitle(data.url);
      if (title) data.title = title;
    }
  },
};
