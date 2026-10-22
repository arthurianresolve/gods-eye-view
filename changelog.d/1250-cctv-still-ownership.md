### Fixed

- Still CCTV projections release continuous rendering while waiting for an image and keep one owned refresh schedule. Late completions cannot restart a hidden or retired projection; decoded frames and the final throttled texture upload survive slow responses and visibility changes. Video and focus fades retain continuous rendering.
