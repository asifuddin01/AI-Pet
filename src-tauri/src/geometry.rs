//! Plain geometry types shared by the window, screen and IPC layers.
//!
//! All values are *logical* points with a top-left origin at the primary display,
//! which matches both CSS pixels in the webview and Tauri's `LogicalPosition`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.x && p.x < self.x + self.width && p.y >= self.y && p.y < self.y + self.height
    }

    pub fn is_valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            && self.width > 0.0
            && self.height > 0.0
            && self.width <= 10_000.0
            && self.height <= 10_000.0
            && self.x.abs() <= 100_000.0
            && self.y.abs() <= 100_000.0
    }

    pub fn offset(&self, by: Point) -> Rect {
        Rect {
            x: self.x + by.x,
            y: self.y + by.y,
            ..*self
        }
    }
}

impl Point {
    pub fn is_valid(&self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.x.abs() <= 100_000.0 && self.y.abs() <= 100_000.0
    }
}

/// Smooth start and stop for roaming movement.
pub fn ease_in_out_sine(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    -((std::f64::consts::PI * t).cos() - 1.0) / 2.0
}

pub fn lerp(a: Point, b: Point, t: f64) -> Point {
    Point {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_contains_is_half_open() {
        let r = Rect { x: 10.0, y: 10.0, width: 20.0, height: 20.0 };
        assert!(r.contains(Point { x: 10.0, y: 10.0 }));
        assert!(r.contains(Point { x: 29.9, y: 29.9 }));
        assert!(!r.contains(Point { x: 30.0, y: 15.0 }));
        assert!(!r.contains(Point { x: 9.9, y: 15.0 }));
    }

    #[test]
    fn rect_validation_rejects_garbage() {
        assert!(Rect { x: 0.0, y: 0.0, width: 100.0, height: 100.0 }.is_valid());
        assert!(!Rect { x: f64::NAN, y: 0.0, width: 100.0, height: 100.0 }.is_valid());
        assert!(!Rect { x: 0.0, y: 0.0, width: 0.0, height: 100.0 }.is_valid());
        assert!(!Rect { x: 0.0, y: 0.0, width: 1e9, height: 100.0 }.is_valid());
    }

    #[test]
    fn easing_hits_endpoints() {
        assert!((ease_in_out_sine(0.0)).abs() < 1e-9);
        assert!((ease_in_out_sine(1.0) - 1.0).abs() < 1e-9);
        assert!((ease_in_out_sine(0.5) - 0.5).abs() < 1e-9);
        assert_eq!(ease_in_out_sine(2.0), 1.0);
    }

    #[test]
    fn lerp_interpolates() {
        let p = lerp(Point { x: 0.0, y: 0.0 }, Point { x: 10.0, y: -10.0 }, 0.25);
        assert_eq!(p, Point { x: 2.5, y: -2.5 });
    }
}
