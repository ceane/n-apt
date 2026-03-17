# Visualization Scripts

Graphics, SVG generation, and IQ data processing utilities.

## 📁 Scripts

- **iq_to_svg.py** - Convert IQ data to SVG visualizations
- **rtl_sdr_capture.py** - RTL-SDR data capture utilities
- **run-iq-capture-tests.sh** - Test IQ capture functionality
- **simple_visual_build.sh** - Simple visualization build pipeline
- **test_visual_output.sh** - Test visual output generation

## 🚀 Usage

### IQ to SVG Conversion
```bash
./iq_to_svg.py input.iq output.svg
```

### RTL-SDR Capture
```bash
./rtl_sdr_capture.py --frequency 101.7 --output capture.iq
```

### Visual Build
```bash
./simple_visual_build.sh
```

### Run Tests
```bash
./run-iq-capture-tests.sh
./test_visual_output.sh
```

## 📝 Notes

- Requires Python with numpy/matplotlib for processing
- RTL-SDR hardware needed for capture scripts
- Output formats: SVG, PNG, raw IQ data
