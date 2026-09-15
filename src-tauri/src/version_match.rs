//! "Bu arama sonucu AYNI şarkının başka bir yüklemesi mi?" — alternatif kaynak.
//!
//! ⛔ BUG'DI (mobilde kullanıcı raporu 2026-09-14, "Midnight City"): eşleşme
//! YALNIZ süreye bakıyordu. M83'ün kaydı oturum istiyordu; arama sonuçlarında
//! süresi 4 sn farklı "Outro" — aynı sanatçının BAŞKA şarkısı — öndeydi →
//! parça "Outro"ya bağlandı ve senkronla diğer cihazlara da geçti. Aynı aramada
//! başka sanatçının "Radio Edit"i, "slowed + reverb" ve canlı kayıtlar da %20
//! süre sınırının içindeydi. Masaüstündeki `find_alternative` da aynı hatayı
//! taşıyordu.
//!
//! Mobilin `versionMatch.ts`'inin Rust karşılığı (eşikler ve puanlar aynı):
//! başlık çekirdeği aynı + sanatçı tutuyor + orijinalde olmayan bir sürüm
//! işareti (remix, slowed, live, cover…) yok. Kalanlar puanla sıralanır.

use std::collections::HashSet;

/// Orijinal başlıkta yoksa adayı ELER — farklı kayıt, farklı ses.
const REJECT_MARKERS: &[&str] = &[
    "sped up", "speed up", "spedup", "slowed", "reverb", "nightcore", "8d", "remix", "rmx",
    "cover", "karaoke", "instrumental", "enstrumantal", "acoustic", "akustik", "live", "canli",
    "concert", "konser", "mashup", "bass boosted", "lofi", "lo fi", "piano", "type beat", "loop",
    "reaction", "tepki", "tutorial", "unplugged", "acapella", "a cappella", "reversed", "chopped",
    "remake", "orchestral", "symphonic", "tiktok", "shorts", "parody", "phonk", "hardstyle", "demo",
];
/// Aynı ses olabilir ama emin değiliz → puan düşer, elenmez.
const SOFT_MARKERS: &[&str] = &["edit", "extended", "version", "mix", "clean", "mono", "radio"];

const DURATION_TOLERANCE: f64 = 0.2;
const MIN_TOLERANCE_MS: f64 = 12_000.0;
/// Bunun altı "eşleşiyor" sayılmaz (mobilde gerçek arama sonuçlarıyla ölçüldü).
const MIN_MATCH_SCORE: f64 = -4.0;

/// songCore'daki sürüm etiketleri (recommender.ts `VERSION_MARKERS`).
const VERSION_WORDS: &[&str] = &[
    "sped", "spedup", "slowed", "reverb", "remix", "cover", "lyric", "lyrics", "official",
    "audio", "video", "hd", "4k", "remaster", "remastered", "live", "acoustic", "instrumental",
    "karaoke", "8d", "nightcore", "edit", "version", "mix", "extended", "radio", "clip", "mv",
    "hq", "visualizer", "performance",
];
const STOP_WORDS: &[&str] = &[
    "the", "a", "an", "feat", "ft", "featuring", "and", "ve", "x", "with", "music", "song",
    "prod", "by", "de", "la", "el",
];

pub struct Candidate<'a> {
    pub title: &'a str,
    pub artist: &'a str,
    pub duration_ms: u64,
}

/// Küçük harf + Türkçe/aksanlı harf sadeleştirme ("Gül" ile "Gul" eşleşsin).
fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        let mapped = match ch {
            'İ' | 'I' | 'ı' | 'î' | 'Î' | 'í' | 'ì' | 'ï' => 'i',
            'Ç' | 'ç' => 'c',
            'Ğ' | 'ğ' => 'g',
            'Ö' | 'ö' | 'ó' | 'ò' | 'ô' | 'õ' => 'o',
            'Ş' | 'ş' => 's',
            'Ü' | 'ü' | 'û' | 'ú' | 'ù' => 'u',
            'â' | 'Â' | 'á' | 'à' | 'ä' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'É' => 'e',
            'ñ' => 'n',
            _ => {
                for l in ch.to_lowercase() {
                    out.push(l);
                }
                continue;
            }
        };
        out.push(mapped);
    }
    out
}

fn flat(s: &str) -> String {
    fold(s).chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}

fn strip_channel(s: &str) -> String {
    let t = s.trim();
    let lower = t.to_lowercase();
    let t = if lower.ends_with("- topic") {
        t[..t.len() - "- topic".len()].trim_end()
    } else if lower.ends_with("vevo") {
        t[..t.len() - "vevo".len()].trim_end()
    } else {
        t
    };
    t.trim().to_string()
}

/// Kelimeleri boşlukla ayrılmış hâle getirir; "s l o w e d" → "slowed".
fn marker_text(title: &str) -> String {
    let normalized: String = fold(title)
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect();
    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    let mut words: Vec<String> = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        // 3+ ardışık tek karakterlik belirteç birleşir.
        let mut j = i;
        while j < tokens.len() && tokens[j].len() == 1 {
            j += 1;
        }
        if j - i >= 3 {
            words.push(tokens[i..j].concat());
            i = j;
        } else {
            words.push(tokens[i].to_string());
            i += 1;
        }
    }
    format!(" {} ", words.join(" "))
}

fn count_marker(text: &str, marker: &str) -> usize {
    let needle = format!(" {marker} ");
    let mut n = 0;
    let mut from = 0;
    while let Some(pos) = text[from..].find(&needle) {
        n += 1;
        from += pos + needle.len() - 1;
    }
    n
}

fn has_hours(text: &str) -> bool {
    let words: Vec<&str> = text.split_whitespace().collect();
    words.windows(2).any(|w| {
        w[0].chars().all(|c| c.is_ascii_digit())
            && matches!(w[1], "hour" | "hours" | "saat")
    }) || words.iter().any(|w| {
        let digits: String = w.chars().take_while(|c| c.is_ascii_digit()).collect();
        !digits.is_empty() && matches!(&w[digits.len()..], "hour" | "hours" | "saat")
    })
}

fn remove_brackets(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0i32;
    for ch in s.chars() {
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out
}

/// recommender.ts `songCore` — sanatçıdan bağımsız şarkı adı çekirdeği (kelimeler).
fn song_core_words(title: &str, artist: &str) -> Vec<String> {
    let clean = remove_brackets(&fold(title));
    let artist_key = flat(artist);
    let segs: Vec<String> = clean
        .split(['-', '–', '—', '|', ':'])
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .collect();
    let mut parts = segs.clone();
    if segs.len() > 1 && !artist_key.is_empty() {
        let kept: Vec<String> = segs
            .iter()
            .filter(|sg| {
                let k = flat(sg);
                !(k.is_empty() || artist_key.contains(&k) || k.contains(&artist_key))
            })
            .cloned()
            .collect();
        if !kept.is_empty() {
            parts = kept;
        }
    }
    let mut joined = parts.join(" ");
    // "ft. Pharrell Williams, Nile Rodgers" — konuk sanatçılar şarkı adı değil;
    // sayılsaydı resmi yükleme "4 fazla kelime" diye elenirdi (ölçüldü: Get Lucky).
    for tag in [" feat. ", " feat ", " ft. ", " ft ", " featuring "] {
        if let Some(pos) = format!(" {joined} ").find(tag) {
            joined.truncate(pos.saturating_sub(1).min(joined.len()));
            break;
        }
    }
    let mut seen = HashSet::new();
    let mut words: Vec<String> = joined
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| w.len() > 1)
        .filter(|w| !STOP_WORDS.contains(w) && !VERSION_WORDS.contains(w))
        .filter(|w| seen.insert(w.to_string()))
        .map(|w| w.to_string())
        .collect();
    // "sped up": "up" tek başına dolgu değil ama "sped" ile birlikte etiket.
    if joined.contains("sped up") {
        words.retain(|w| w != "up");
    }
    words.sort();
    words
}

fn artist_keys(title: &str, artist: &str) -> Vec<String> {
    let mut names = vec![artist.to_string()];
    let dash: Vec<&str> = split_dash(title);
    if dash.len() > 1 {
        names.push(dash[0].to_string());
    }
    let mut keys: Vec<String> = Vec::new();
    for name in names {
        let cleaned = strip_channel(&name);
        let mut parts = vec![cleaned.clone()];
        let lowered = fold(&cleaned);
        let replaced = [" feat. ", " feat ", " ft. ", " ft ", " x ", " ve ", " and ", ",", "&", "+", "/"]
            .iter()
            .fold(format!(" {lowered} "), |acc, sep| acc.replace(sep, "\u{1}"));
        parts.extend(replaced.split('\u{1}').map(|p| p.trim().to_string()));
        for p in parts {
            let k = flat(&p);
            if k.len() >= 2 && !keys.contains(&k) {
                keys.push(k);
            }
        }
    }
    keys
}

fn split_dash(title: &str) -> Vec<&str> {
    for sep in [" - ", " – ", " — "] {
        if title.contains(sep) {
            return title.splitn(2, sep).collect();
        }
    }
    vec![title]
}

fn artist_words(names: &[&str]) -> HashSet<String> {
    let mut set = HashSet::new();
    for n in names {
        for w in fold(&strip_channel(n)).split(|c: char| !c.is_ascii_alphanumeric()) {
            if w.len() > 1 {
                set.insert(w.to_string());
            }
        }
    }
    set
}

fn loose_key(s: &str) -> String {
    remove_brackets(&fold(s))
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation() && !"–—“”‘’«»・、。！？「」『』".contains(*c))
        .collect()
}

/// Adayın puanı; `None` = aynı şarkı DEĞİL (elendi). Yüksek puan önce denenir.
pub fn version_score(
    orig_title: &str,
    orig_artist: &str,
    orig_duration_ms: u64,
    cand: &Candidate,
) -> Option<f64> {
    let a = marker_text(orig_title);
    let b = marker_text(cand.title);
    for m in REJECT_MARKERS {
        if count_marker(&b, m) > count_marker(&a, m) {
            return None;
        }
    }
    if has_hours(&b) && !has_hours(&a) {
        return None;
    }

    let mut score = 0.0;
    let ow = song_core_words(orig_title, orig_artist);
    if !ow.is_empty() {
        let cw = song_core_words(cand.title, cand.artist);
        let cset: HashSet<&String> = cw.iter().collect();
        let missing = ow.iter().filter(|w| !cset.contains(w)).count();
        if missing > usize::from(ow.len() >= 4) {
            return None;
        }
        let oset: HashSet<&String> = ow.iter().collect();
        let dash = split_dash(orig_title);
        let first = if dash.len() > 1 { dash[0] } else { "" };
        let ignore = artist_words(&[orig_artist, first, cand.artist]);
        let extra = cw
            .iter()
            .filter(|w| !oset.contains(w) && !ignore.contains(w.as_str()))
            .count();
        if extra > 3 {
            return None;
        }
        score -= missing as f64 * 2.0 + extra as f64 * 1.5;
    } else {
        let ok = loose_key(orig_title);
        let ck = loose_key(cand.title);
        if ok.is_empty() || ck.is_empty() || !(ck.contains(&ok) || ok.contains(&ck)) {
            return None;
        }
    }

    // Sanatçı tutmalı: aynı adlı başka sanatçının şarkısı (cover, aynı isim) elenir.
    let keys = artist_keys(orig_title, orig_artist);
    let up = flat(&strip_channel(cand.artist));
    let cand_title = flat(cand.title);
    if !keys.is_empty()
        && !keys.iter().any(|k| {
            (up.len() >= 2 && (up.contains(k.as_str()) || k.contains(up.as_str())))
                || cand_title.contains(k.as_str())
        })
    {
        return None;
    }

    if orig_duration_ms > 0 && cand.duration_ms > 0 {
        let diff = orig_duration_ms.abs_diff(cand.duration_ms) as f64;
        if diff > MIN_TOLERANCE_MS.max(orig_duration_ms as f64 * DURATION_TOLERANCE) {
            return None;
        }
        score -= (diff / 6000.0).min(8.0); // 6 sn sapma = 1 puan
    } else {
        score -= 2.0;
    }
    for m in SOFT_MARKERS {
        if count_marker(&b, m) > count_marker(&a, m) {
            score -= 2.0;
        }
    }
    // Sanatçının kendi kanalı / "Sanatçı - Topic" / VEVO: en güvenilir yükleme.
    let raw_up = flat(cand.artist);
    if keys.iter().any(|k| {
        raw_up == *k
            || raw_up == format!("{k}topic")
            || raw_up == format!("{k}vevo")
            || raw_up == format!("{k}official")
    }) {
        score += 4.0;
    }
    if count_marker(&b, "audio") > 0 {
        score += 1.0;
    }
    if count_marker(&b, "lyrics") + count_marker(&b, "lyric") + count_marker(&b, "sozleri") > 0 {
        score -= 0.5;
    }
    if score < MIN_MATCH_SCORE {
        None
    } else {
        Some(score)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn score(title: &str, artist: &str, dur: u64) -> Option<f64> {
        version_score("Midnight City", "M83", 244_000, &Candidate { title, artist, duration_ms: dur })
    }

    #[test]
    fn midnight_city_outro_is_rejected() {
        // Kullanıcı raporundaki yanlış bağlantı: aynı sanatçı, başka şarkı.
        assert_eq!(score("Outro", "M83", 248_000), None);
    }

    #[test]
    fn official_video_is_accepted() {
        assert!(score("M83 'Midnight City' Official video", "M83VEVO", 243_000).is_some());
        assert!(score("Midnight City", "M83 - Topic", 244_000).is_some());
    }

    #[test]
    fn other_versions_are_rejected() {
        assert_eq!(score("Midnight City (slowed + reverb)", "M83", 250_000), None);
        assert_eq!(score("M83 - Midnight City (Live at Coachella)", "M83", 250_000), None);
        assert_eq!(score("Midnight City", "Some Cover Band", 244_000), None);
        assert_eq!(score("Midnight City 1 hour loop", "M83", 244_000), None);
        assert_eq!(score("Midnight City", "M83", 400_000), None); // süre çok saptı
    }

    #[test]
    fn official_beats_lyrics() {
        let official = score("M83 - Midnight City (Official Audio)", "M83", 244_000).unwrap();
        let lyrics = score("M83 - Midnight City (Lyrics)", "Lyric Channel M83", 246_000).unwrap();
        assert!(official > lyrics, "{official} <= {lyrics}");
    }

    #[test]
    fn turkish_letters_fold() {
        let s = version_score(
            "Gülümse",
            "Sezen Aksu",
            240_000,
            &Candidate { title: "Sezen Aksu - Gulumse (Official Audio)", artist: "Sezen Aksu", duration_ms: 241_000 },
        );
        assert!(s.is_some());
    }

    #[test]
    fn featured_artists_are_not_extra_words() {
        let s = version_score(
            "Get Lucky",
            "Daft Punk",
            248_000,
            &Candidate {
                title: "Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers",
                artist: "Daft Punk",
                duration_ms: 249_000,
            },
        );
        assert!(s.is_some());
    }

    #[test]
    fn spaced_marker_is_detected() {
        assert_eq!(score("Midnight City s l o w e d", "M83", 250_000), None);
    }
}
