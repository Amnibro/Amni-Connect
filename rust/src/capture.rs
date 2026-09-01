use crate::wire;
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

const VIDEO_PORT: u16 = 7879;

struct Want {
    run: AtomicBool,
    idr: AtomicBool,
    fps: AtomicU32,
    kbps: AtomicU32,
    output: AtomicU32,
}

struct Hub {
    want: Want,
    clients: Mutex<Vec<mpsc::Sender<Vec<u8>>>>,
    last_err: Mutex<String>,
    ready: AtomicBool,
    hw: AtomicBool,
    width: AtomicU32,
    height: AtomicU32,
}

static HUB: OnceLock<Hub> = OnceLock::new();

fn hub() -> &'static Hub {
    HUB.get_or_init(|| Hub {
        want: Want {
            run: AtomicBool::new(false),
            idr: AtomicBool::new(false),
            fps: AtomicU32::new(60),
            kbps: AtomicU32::new(12000),
            output: AtomicU32::new(0),
        },
        clients: Mutex::new(Vec::new()),
        last_err: Mutex::new(String::new()),
        ready: AtomicBool::new(false),
        hw: AtomicBool::new(false),
        width: AtomicU32::new(0),
        height: AtomicU32::new(0),
    })
}

fn set_err(msg: impl Into<String>) {
    let m = msg.into();
    eprintln!("[amni-control] capture {m}");
    if let Ok(mut g) = hub().last_err.lock() {
        *g = m;
    }
}

fn broadcast(pkt: Vec<u8>) {
    let mut g = match hub().clients.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    g.retain(|c| c.send(pkt.clone()).is_ok());
}

fn status_json() -> String {
    let h = hub();
    let err = h.last_err.lock().ok().map(|g| g.clone()).unwrap_or_default();
    format!(
        "{}\n",
        json!({
            "type": "capture-status",
            "ok": h.ready.load(Ordering::Relaxed),
            "hw": h.hw.load(Ordering::Relaxed),
            "width": h.width.load(Ordering::Relaxed),
            "height": h.height.load(Ordering::Relaxed),
            "fps": h.want.fps.load(Ordering::Relaxed),
            "kbps": h.want.kbps.load(Ordering::Relaxed),
            "encoder": if h.hw.load(Ordering::Relaxed) { "mf-hardware" } else if h.ready.load(Ordering::Relaxed) { "mf-software" } else { "none" },
            "reason": err,
        })
    )
}

pub fn command(v: &serde_json::Value) -> String {
    let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    let h = hub();
    match t {
        "capture-start" | "capture-update" => {
            if let Some(n) = v.get("fps").and_then(|x| x.as_u64()) {
                h.want.fps.store(n.clamp(15, 120) as u32, Ordering::Relaxed);
            }
            if let Some(n) = v.get("kbps").and_then(|x| x.as_u64()) {
                h.want.kbps.store(n.clamp(500, 80000) as u32, Ordering::Relaxed);
            }
            if let Some(n) = v.get("output").and_then(|x| x.as_u64()) {
                h.want.output.store(n as u32, Ordering::Relaxed);
            }
            if t == "capture-start" {
                h.want.run.store(true, Ordering::Relaxed);
                h.want.idr.store(true, Ordering::Relaxed);
            }
        }
        "capture-stop" => {
            h.want.run.store(false, Ordering::Relaxed);
            h.ready.store(false, Ordering::Relaxed);
        }
        "capture-idr" => h.want.idr.store(true, Ordering::Relaxed),
        _ => {}
    }
    status_json()
}

pub fn spawn() {
    let _ = hub();
    std::thread::Builder::new()
        .name("amni-capture".into())
        .spawn(|| {
            if let Err(e) = capture_loop() {
                set_err(format!("loop ended: {e}"));
                hub().ready.store(false, Ordering::Relaxed);
            }
        })
        .ok();
    std::thread::Builder::new()
        .name("amni-video-listen".into())
        .spawn(|| {
            let rt = tokio::runtime::Builder::new_current_thread().enable_all().build();
            if let Ok(rt) = rt {
                rt.block_on(video_listen());
            }
        })
        .ok();
}

async fn video_listen() {
    let Ok(listener) = TcpListener::bind(("127.0.0.1", VIDEO_PORT)).await else {
        set_err("video port 7879 bind failed");
        return;
    };
    eprintln!("[amni-control] video listen 127.0.0.1:{VIDEO_PORT}");
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        if let Ok(mut g) = hub().clients.lock() {
            g.push(tx);
        }
        tokio::spawn(async move {
            let mut w = stream;
            while let Ok(pkt) = rx.recv() {
                if w.write_all(&pkt).await.is_err() {
                    break;
                }
            }
        });
    }
}

fn capture_loop() -> Result<(), String> {
    loop {
        if !hub().want.run.load(Ordering::Relaxed) {
            hub().ready.store(false, Ordering::Relaxed);
            std::thread::sleep(Duration::from_millis(80));
            continue;
        }
        match session() {
            Ok(()) => {}
            Err(e) => {
                set_err(e);
                hub().ready.store(false, Ordering::Relaxed);
                std::thread::sleep(Duration::from_millis(400));
            }
        }
    }
}

#[cfg(windows)]
fn session() -> Result<(), String> {
    win::run_session()
}

#[cfg(not(windows))]
fn session() -> Result<(), String> {
    Err("unsupported".into())
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::Interface;
    use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1};
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
    use windows::Win32::Graphics::Dxgi::{IDXGIDevice, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource, DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO, DXGI_OUTPUT_DESC};
    use windows::Win32::Media::MediaFoundation::{
        CMSH264EncoderMFT, ICodecAPI, IMFActivate, IMFTransform, MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample, MFStartup, MFTEnumEx, MFMediaType_Video, MFVideoFormat_H264, MFVideoFormat_NV12, MF_E_TRANSFORM_NEED_MORE_INPUT, MF_LOW_LATENCY, MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_MPEG2_PROFILE, MF_MT_SUBTYPE, MF_VERSION, MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER, MFT_ENUM_FLAG_SYNCMFT, MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_OUTPUT_DATA_BUFFER, MFT_REGISTER_TYPE_INFO, eAVEncH264VProfile_High, MFSTARTUP_FULL, MFVideoInterlace_Progressive,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};

    fn pack2(a: u32, b: u32) -> u64 {
        ((a as u64) << 32) | b as u64
    }

    pub fn run_session() -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(|e| format!("MFStartup {e}"))?;

            let fps = hub().want.fps.load(Ordering::Relaxed).max(15);
            let kbps = hub().want.kbps.load(Ordering::Relaxed).max(500);
            let output_idx = hub().want.output.load(Ordering::Relaxed);

            let mut device: Option<ID3D11Device> = None;
            let mut ctx: Option<ID3D11DeviceContext> = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                None,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut ctx),
            )
            .map_err(|e| format!("D3D11CreateDevice {e}"))?;
            let device = device.ok_or("no d3d device")?;
            let ctx = ctx.ok_or("no d3d ctx")?;

            let dxgi: IDXGIDevice = device.cast().map_err(|e| format!("IDXGIDevice {e}"))?;
            let adapter = dxgi.GetAdapter().map_err(|e| format!("GetAdapter {e}"))?;
            let output = adapter.EnumOutputs(output_idx).or_else(|_| adapter.EnumOutputs(0)).map_err(|e| format!("EnumOutputs {e}"))?;
            let output1: IDXGIOutput1 = output.cast().map_err(|e| format!("IDXGIOutput1 {e}"))?;
            let dup: IDXGIOutputDuplication = output1.DuplicateOutput(&device).map_err(|e| format!("DuplicateOutput {e}"))?;

            let mut desc = DXGI_OUTPUT_DESC::default();
            let _ = output.GetDesc(&mut desc);
            let mut w = (desc.DesktopCoordinates.right - desc.DesktopCoordinates.left) as u32;
            let mut h = (desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top) as u32;
            if w < 2 || h < 2 {
                w = 1920;
                h = 1080;
            }
            let (w, h) = wire::even_size(w, h);
            hub().width.store(w, Ordering::Relaxed);
            hub().height.store(h, Ordering::Relaxed);

            let (enc, hw) = open_encoder(w, h, fps, kbps)?;
            hub().hw.store(hw, Ordering::Relaxed);
            hub().ready.store(true, Ordering::Relaxed);
            set_err("");

            let hello = json!({
                "type":"hw-hello","codec":"avc1.640028","width":w,"height":h,"fps":fps,"kbps":kbps,"hw":hw
            });
            broadcast(wire::pack_packet(wire::KIND_HELLO, 0, 0, hello.to_string().as_bytes()));

            let mut staging: Option<ID3D11Texture2D> = None;
            let start = Instant::now();
            let frame_dt = Duration::from_micros(1_000_000 / fps.max(1) as u64);
            let mut next = Instant::now();

            while hub().want.run.load(Ordering::Relaxed) {
                if hub().want.fps.load(Ordering::Relaxed) != fps || hub().want.kbps.load(Ordering::Relaxed) != kbps {
                    break;
                }
                let now = Instant::now();
                if now < next {
                    std::thread::sleep(next.saturating_duration_since(now).min(Duration::from_millis(8)));
                }
                next = Instant::now() + frame_dt;

                let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
                let mut resource: Option<IDXGIResource> = None;
                match dup.AcquireNextFrame(40, &mut info, &mut resource) {
                    Ok(()) => {}
                    Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => continue,
                    Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST => return Err("dxgi access lost".into()),
                    Err(e) => return Err(format!("AcquireNextFrame {e}")),
                }
                let Some(resource) = resource else {
                    let _ = dup.ReleaseFrame();
                    continue;
                };
                let tex: ID3D11Texture2D = resource.cast().map_err(|e| format!("frame tex {e}"))?;
                if staging.is_none() {
                    let mut td = D3D11_TEXTURE2D_DESC::default();
                    tex.GetDesc(&mut td);
                    td.Usage = D3D11_USAGE_STAGING;
                    td.BindFlags = 0;
                    td.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
                    td.MiscFlags = 0;
                    td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
                    let mut created = None;
                    device.CreateTexture2D(&td, None, Some(&mut created)).map_err(|e| format!("staging {e}"))?;
                    staging = created;
                }
                let st = staging.as_ref().unwrap();
                ctx.CopyResource(st, &tex);
                let _ = dup.ReleaseFrame();

                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                ctx.Map(st, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).map_err(|e| format!("Map {e}"))?;
                let pitch = mapped.RowPitch as usize;
                let src = std::slice::from_raw_parts(mapped.pData as *const u8, pitch * h as usize);
                let nv = wire::bgra_to_nv12(src, pitch, w, h);
                ctx.Unmap(st, 0);

                let force = hub().want.idr.swap(false, Ordering::Relaxed);
                if force {
                    force_key(&enc);
                }
                if let Some((au, key)) = encode_nv12(&enc, &nv, w, h, fps, start.elapsed())? {
                    let flags = if key || force { wire::FLAG_KEY } else { 0 };
                    let ts = start.elapsed().as_millis() as u32;
                    broadcast(wire::pack_packet(wire::KIND_VIDEO, flags, ts, &au));
                }
            }
            hub().ready.store(false, Ordering::Relaxed);
            Ok(())
        }
    }

    unsafe fn open_encoder(w: u32, h: u32, fps: u32, kbps: u32) -> Result<(IMFTransform, bool), String> {
        if let Ok(enc) = enum_encoder(true).and_then(|e| configure(e, w, h, fps, kbps).map(|e| (e, true))) {
            return Ok(enc);
        }
        if let Ok(enc) = enum_encoder(false).and_then(|e| configure(e, w, h, fps, kbps).map(|e| (e, false))) {
            return Ok(enc);
        }
        let enc: IMFTransform = CoCreateInstance(&CMSH264EncoderMFT, None, CLSCTX_INPROC_SERVER).map_err(|e| format!("CMSH264 {e}"))?;
        configure(enc, w, h, fps, kbps).map(|e| (e, false))
    }

    unsafe fn enum_encoder(hw: bool) -> Result<IMFTransform, String> {
        let info = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 };
        let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0u32;
        let flags = if hw { MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER } else { MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER };
        MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, flags, None, Some(&info as *const _), &mut activates, &mut count).map_err(|e| format!("MFTEnumEx {e}"))?;
        if activates.is_null() || count == 0 {
            return Err("no encoder".into());
        }
        let first = &*activates;
        let act = first.clone().ok_or("null activate")?;
        let enc: IMFTransform = act.ActivateObject::<IMFTransform>().map_err(|e| format!("ActivateObject {e}"))?;
        CoTaskMemFree(Some(activates as *const _));
        Ok(enc)
    }

    unsafe fn configure(enc: IMFTransform, w: u32, h: u32, fps: u32, kbps: u32) -> Result<IMFTransform, String> {
        if let Ok(attrs) = enc.GetAttributes() {
            let _ = attrs.SetUINT32(&MF_LOW_LATENCY, 1);
        }
        let out_ty = MFCreateMediaType().map_err(|e| format!("out type {e}"))?;
        out_ty.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(|e| format!("{e}"))?;
        out_ty.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264).map_err(|e| format!("{e}"))?;
        out_ty.SetUINT32(&MF_MT_AVG_BITRATE, kbps.saturating_mul(1000)).map_err(|e| format!("{e}"))?;
        out_ty.SetUINT64(&MF_MT_FRAME_SIZE, pack2(w, h)).map_err(|e| format!("{e}"))?;
        out_ty.SetUINT64(&MF_MT_FRAME_RATE, pack2(fps, 1)).map_err(|e| format!("{e}"))?;
        out_ty.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32).map_err(|e| format!("{e}"))?;
        out_ty.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32).ok();
        enc.SetOutputType(0, &out_ty, 0).map_err(|e| format!("SetOutputType {e}"))?;

        let in_ty = MFCreateMediaType().map_err(|e| format!("in type {e}"))?;
        in_ty.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(|e| format!("{e}"))?;
        in_ty.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12).map_err(|e| format!("{e}"))?;
        in_ty.SetUINT64(&MF_MT_FRAME_SIZE, pack2(w, h)).map_err(|e| format!("{e}"))?;
        in_ty.SetUINT64(&MF_MT_FRAME_RATE, pack2(fps, 1)).map_err(|e| format!("{e}"))?;
        in_ty.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32).map_err(|e| format!("{e}"))?;
        enc.SetInputType(0, &in_ty, 0).map_err(|e| format!("SetInputType {e}"))?;

        enc.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0).ok();
        enc.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0).ok();
        Ok(enc)
    }

    unsafe fn force_key(enc: &IMFTransform) {
        if let Ok(api) = enc.cast::<ICodecAPI>() {
            let _ = api.IsSupported(&windows::Win32::Media::MediaFoundation::CODECAPI_AVEncVideoForceKeyFrame);
        }
        let _ = enc;
    }

    unsafe fn encode_nv12(enc: &IMFTransform, nv: &[u8], _w: u32, _h: u32, fps: u32, elapsed: Duration) -> Result<Option<(Vec<u8>, bool)>, String> {
        let buf = MFCreateMemoryBuffer(nv.len() as u32).map_err(|e| format!("membuf {e}"))?;
        let mut ptr = std::ptr::null_mut();
        let mut max = 0u32;
        buf.Lock(&mut ptr, Some(&mut max), None).map_err(|e| format!("Lock {e}"))?;
        if !ptr.is_null() {
            let n = nv.len().min(max as usize);
            std::ptr::copy_nonoverlapping(nv.as_ptr(), ptr, n);
        }
        buf.Unlock().ok();
        buf.SetCurrentLength(nv.len() as u32).ok();
        let sample = MFCreateSample().map_err(|e| format!("sample {e}"))?;
        sample.AddBuffer(&buf).map_err(|e| format!("AddBuffer {e}"))?;
        let t = (elapsed.as_nanos() / 100) as i64;
        sample.SetSampleTime(t).ok();
        sample.SetSampleDuration((10_000_000 / fps.max(1) as i64) as i64).ok();
        enc.ProcessInput(0, &sample, 0).map_err(|e| format!("ProcessInput {e}"))?;

        let info = enc.GetOutputStreamInfo(0).unwrap_or_default();
        let out_sample = MFCreateSample().map_err(|e| format!("out sample {e}"))?;
        if info.cbSize > 0 {
            let ob = MFCreateMemoryBuffer(info.cbSize.max(1)).map_err(|e| format!("out buf {e}"))?;
            out_sample.AddBuffer(&ob).ok();
        }
        let mut out = MFT_OUTPUT_DATA_BUFFER::default();
        out.dwStreamID = 0;
        *out.pSample = Some(out_sample);
        let mut status = 0u32;
        match enc.ProcessOutput(0, std::slice::from_mut(&mut out), &mut status) {
            Ok(()) => {
                let Some(s) = (*out.pSample).as_ref() else { return Ok(None) };
                let b = s.GetBufferByIndex(0).map_err(|e| format!("GetBuffer {e}"))?;
                let mut p = std::ptr::null_mut();
                let mut len = 0u32;
                b.Lock(&mut p, None, Some(&mut len)).map_err(|e| format!("out lock {e}"))?;
                let bytes = if p.is_null() { Vec::new() } else { std::slice::from_raw_parts(p, len as usize).to_vec() };
                b.Unlock().ok();
                if bytes.is_empty() {
                    return Ok(None);
                }
                let key = wire::annexb_is_key(&bytes);
                Ok(Some((bytes, key)))
            }
            Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => Ok(None),
            Err(e) => Err(format!("ProcessOutput {e}")),
        }
    }
}
