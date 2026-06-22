// Spotify Web API — yalnızca METADATA (şarkı adı + sanatçı).
// Spotify'ın sesi alınamaz; bu liste daha sonra YouTube'da eşleştirilir.
// Client Credentials akışı: kullanıcı girişi gerekmez, public playlist'ler için yeterli.

use reqwest::blocking::Client;

#[derive(Debug, Clone)]
pub struct SpTrack {
    pub title: String,
    pub artist: String,
}

/// open.spotify.com/playlist/<ID>?... → <ID>
pub fn playlist_id_from_url(url: &str) -> Option<String> {
    let u = url.trim();
    let marker = "playlist/";
    let start = u.find(marker)? + marker.len();
    let id: String = u[start..]
        .chars()
        .take_while(|c| c.is_alphanumeric())
        .collect();
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

/// Client Credentials ile erişim token'ı alır.
pub fn get_token(client_id: &str, client_secret: &str) -> anyhow::Result<String> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        anyhow::bail!("Spotify API anahtarı eksik (Ayarlar → Entegrasyonlar).");
    }
    let client = Client::new();
    let resp = client
        .post("https://accounts.spotify.com/api/token")
        .basic_auth(client_id.trim(), Some(client_secret.trim()))
        .form(&[("grant_type", "client_credentials")])
        .send()?;
    if !resp.status().is_success() {
        anyhow::bail!("Spotify kimlik doğrulama başarısız — client_id / secret doğru mu?");
    }
    let j: serde_json::Value = resp.json()?;
    j.get("access_token")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("Spotify token alınamadı"))
}

/// Playlist adını ve tüm şarkı metadata'sını (sayfalı) getirir.
pub fn fetch_playlist(
    token: &str,
    playlist_id: &str,
) -> anyhow::Result<(String, Vec<SpTrack>)> {
    let client = Client::new();

    let meta: serde_json::Value = client
        .get(format!(
            "https://api.spotify.com/v1/playlists/{playlist_id}?fields=name"
        ))
        .bearer_auth(token)
        .send()?
        .json()?;
    let name = meta
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or("Spotify Listesi")
        .to_string();

    let mut tracks = Vec::new();
    let mut offset: u64 = 0;
    loop {
        let url = format!(
            "https://api.spotify.com/v1/playlists/{playlist_id}/tracks\
             ?limit=100&offset={offset}\
             &fields=total,items(track(name,artists(name)))"
        );
        let page: serde_json::Value =
            client.get(&url).bearer_auth(token).send()?.json()?;

        let items = page
            .get("items")
            .and_then(|x| x.as_array())
            .cloned()
            .unwrap_or_default();
        if items.is_empty() {
            break;
        }
        for it in &items {
            let Some(t) = it.get("track") else { continue };
            let title = t
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if title.is_empty() {
                continue;
            }
            let artist = t
                .get("artists")
                .and_then(|a| a.as_array())
                .and_then(|a| a.first())
                .and_then(|a| a.get("name"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            tracks.push(SpTrack { title, artist });
        }

        offset += 100;
        let total = page.get("total").and_then(|x| x.as_u64()).unwrap_or(0);
        if offset >= total {
            break;
        }
    }

    Ok((name, tracks))
}
