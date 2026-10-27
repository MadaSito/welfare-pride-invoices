# Welfare Pride brand asset package

This package preserves the supplied logo source and prepares practical, aspect-ratio-safe variants for the application and its invoices.

| Asset | Purpose |
| --- | --- |
| `WelfarePrideMainlogo-original.webp` | Unmodified supplied source logo |
| `welfare-pride-logo-light.png` | Transparent PNG for light document/background use and server PDF rendering |
| `welfare-pride-logo-dark.png` | Transparent PNG with lightened dark linework for dark-surface UI use |
| `welfare-pride-logo-512.png` | Medium optimized presentation/export size |
| `welfare-pride-logo-256.png` | Compact thumbnail/app-icon-adjacent size |
| `Welfare-Pride-Letterhead.html` | Editable letterhead reference using the Welfare Pride logo and Roboto typography |

The application also includes local Roboto Regular, Medium, and Bold font files in `client/public/brand/fonts/` and uses them in browser UI and generated PDF invoices.

Primary brand colours are Welfare Pride blue `#5A92C9`, Welfare Pride orange `#D58240`, white `#FFFFFF`, and black `#000000`. Do not distort any logo variant. The invoice engine implements a bounded contain fit (50–160% administrator scale) so a company logo retains its natural aspect ratio in every PDF.
