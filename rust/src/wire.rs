pub const MAGIC: u32 = 0x31434E41; // ANC1
pub const HEADER_LEN: usize = 16;
pub const KIND_HELLO: u16 = 1;
pub const KIND_VIDEO: u16 = 2;
pub const FLAG_KEY: u16 = 1;

pub fn pack_header(kind: u16, flags: u16, ts_ms: u32, payload_len: u32) -> [u8; HEADER_LEN] {
    let mut h = [0u8; HEADER_LEN];
    h[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    h[4..8].copy_from_slice(&payload_len.to_le_bytes());
    h[8..10].copy_from_slice(&kind.to_le_bytes());
    h[10..12].copy_from_slice(&flags.to_le_bytes());
    h[12..16].copy_from_slice(&ts_ms.to_le_bytes());
    h
}

#[allow(dead_code)]
pub fn unpack_header(buf: &[u8]) -> Option<(u16, u16, u32, u32)> {
    if buf.len() < HEADER_LEN {
        return None;
    }
    let magic = u32::from_le_bytes(buf[0..4].try_into().ok()?);
    if magic != MAGIC {
        return None;
    }
    let payload_len = u32::from_le_bytes(buf[4..8].try_into().ok()?);
    let kind = u16::from_le_bytes(buf[8..10].try_into().ok()?);
    let flags = u16::from_le_bytes(buf[10..12].try_into().ok()?);
    let ts_ms = u32::from_le_bytes(buf[12..16].try_into().ok()?);
    Some((kind, flags, ts_ms, payload_len))
}

pub fn pack_packet(kind: u16, flags: u16, ts_ms: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_LEN + payload.len());
    out.extend_from_slice(&pack_header(kind, flags, ts_ms, payload.len() as u32));
    out.extend_from_slice(payload);
    out
}

pub fn even_size(w: u32, h: u32) -> (u32, u32) {
    (w & !1, h & !1)
}

pub fn bgra_to_nv12(bgra: &[u8], stride: usize, width: u32, height: u32) -> Vec<u8> {
    let (width, height) = even_size(width, height);
    let w = width as usize;
    let h = height as usize;
    let mut nv = vec![0u8; w * h + w * h / 2];
    for y in 0..h {
        for x in 0..w {
            let i = y * stride + x * 4;
            if i + 2 >= bgra.len() {
                continue;
            }
            let b = bgra[i] as i32;
            let g = bgra[i + 1] as i32;
            let r = bgra[i + 2] as i32;
            let yv = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
            nv[y * w + x] = yv.clamp(0, 255) as u8;
        }
    }
    let uv = w * h;
    for y in (0..h).step_by(2) {
        for x in (0..w).step_by(2) {
            let mut r = 0i32;
            let mut g = 0i32;
            let mut b = 0i32;
            let mut n = 0i32;
            for dy in 0..2 {
                for dx in 0..2 {
                    let i = (y + dy) * stride + (x + dx) * 4;
                    if i + 2 >= bgra.len() {
                        continue;
                    }
                    b += bgra[i] as i32;
                    g += bgra[i + 1] as i32;
                    r += bgra[i + 2] as i32;
                    n += 1;
                }
            }
            if n == 0 {
                continue;
            }
            r /= n;
            g /= n;
            b /= n;
            let u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
            let v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
            let o = uv + (y / 2) * w + x;
            if o + 1 < nv.len() {
                nv[o] = u.clamp(0, 255) as u8;
                nv[o + 1] = v.clamp(0, 255) as u8;
            }
        }
    }
    nv
}

pub fn annexb_is_key(au: &[u8]) -> bool {
    let mut i = 0;
    while i + 4 < au.len() {
        let sc = if au[i..].starts_with(&[0, 0, 0, 1]) {
            4
        } else if au[i..].starts_with(&[0, 0, 1]) {
            3
        } else {
            i += 1;
            continue;
        };
        let nal = au[i + sc] & 0x1f;
        if nal == 5 || nal == 7 {
            return true;
        }
        i += sc + 1;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn header_roundtrip() {
        let p = pack_packet(KIND_VIDEO, FLAG_KEY, 1234, b"hi");
        let (k, f, ts, len) = unpack_header(&p).unwrap();
        assert_eq!((k, f, ts, len), (KIND_VIDEO, FLAG_KEY, 1234, 2));
        assert_eq!(&p[HEADER_LEN..], b"hi");
    }
    #[test]
    fn even_dims() {
        assert_eq!(even_size(2753, 1151), (2752, 1150));
        assert_eq!(even_size(1920, 1080), (1920, 1080));
    }
    #[test]
    fn nv12_size() {
        let bgra = vec![0u8; 4 * 4 * 4];
        let nv = bgra_to_nv12(&bgra, 16, 4, 4);
        assert_eq!(nv.len(), 4 * 4 + 4 * 4 / 2);
    }
    #[test]
    fn idr_nal() {
        assert!(annexb_is_key(&[0, 0, 0, 1, 0x65, 0, 0, 0, 1, 0x41]));
        assert!(!annexb_is_key(&[0, 0, 0, 1, 0x41, 0xaa]));
    }
}
