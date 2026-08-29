// Çalma yolunun ses kalitesini ÖLÇMEK için: rodio'nun kendi çözücüsü +
// yeniden örnekleyicisi ile bir dosyayı çıkış hızına çevirip ham PCM yazar.
// Böylece "kullanıcının duyduğu" sinyali ffmpeg ile analiz edebiliyoruz.
//
//   cargo run --example audio_probe -- <giriş.aac> <hedef_hz> <çıkış.raw>
use rodio::Source;
use std::fs::File;
use std::io::{BufReader, BufWriter, Write};

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--config") {
        use rodio::cpal::traits::{DeviceTrait, HostTrait};
        let host = rodio::cpal::default_host();
        let dev = host.default_output_device().expect("çıkış cihazı yok");
        println!("cihaz: {}", dev.name().unwrap_or_default());
        match dev.default_output_config() {
            Ok(c) => println!("varsayılan: {:?}", c),
            Err(e) => println!("varsayılan alınamadı: {e}"),
        }
        if let Ok(list) = dev.supported_output_configs() {
            for (i, c) in list.take(8).enumerate() {
                println!("  [{i}] {:?}", c);
            }
        }
        return;
    }
    let mut args = std::env::args().skip(1);
    let input = args.next().expect("giriş dosyası");
    let rate: u32 = args.next().expect("hedef hz").parse().unwrap();
    let out = args.next().expect("çıkış dosyası");

    let dec = rodio::Decoder::new(BufReader::new(File::open(&input).unwrap())).unwrap();
    eprintln!(
        "kaynak: {} kanal, {} Hz  →  hedef {} Hz",
        dec.channels(),
        dec.sample_rate(),
        rate
    );
    // rodio Sink'in içeride yaptığının aynısı: kanal + hız uyumlama.
    let conv = rodio::source::UniformSourceIterator::<_, i16>::new(dec, 2, rate);
    let mut w = BufWriter::new(File::create(&out).unwrap());
    let mut n = 0u64;
    for s in conv {
        w.write_all(&s.to_le_bytes()).unwrap();
        n += 1;
    }
    w.flush().unwrap();
    eprintln!("{} örnek yazıldı", n);
}

// Not: `--config` argümanıyla çağrılırsa çıkış cihazının rodio'ya gösterdiği
// yapılandırmayı yazar (hangi hızda/formatta açılıyoruz — ses kalitesi
// şikâyetlerinde ilk bakılacak yer).
