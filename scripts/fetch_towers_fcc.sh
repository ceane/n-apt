#!/bin/bash

# FCC Tower Data Fetch and Process Script
# Downloads, extracts, parses, and converts FCC tower data to JSON

set -e  # Exit on any error

# Configuration
FTP_BASE_URL="ftp://wirelessftp.fcc.gov/pub/uls/complete"
DATA_DIR="./data"
EXTRACTED_DIR="$DATA_DIR/extracted"
JSON_DIR="$DATA_DIR/json"

# Files to download (cell tower specific)
FILES=(
    "a_cell.zip"      # Cell applications
    "l_cell.zip"      # Cell licenses
    "a_tower.zip"     # Tower applications (includes cell towers)
    "l_tower.zip"     # Tower licenses (includes cell towers)
    "d_tower.zip"     # Tower daily updates
    "r_tower.zip"     # Tower reference data
)

# Clean and create directories
echo "🧹 Setting up directories..."
mkdir -p "$DATA_DIR" "$EXTRACTED_DIR" "$JSON_DIR"

# Check for force flag
FORCE_DOWNLOAD=false
if [ "$1" = "--force" ]; then
    FORCE_DOWNLOAD=true
    echo "🔄 Force mode enabled - ignoring cached data"
    echo ""
fi

# Check if we already have processed JSON data
JSON_EXISTS=false
SKIP_DOWNLOAD=false

if [ "$FORCE_DOWNLOAD" = false ] && [ -f "$JSON_DIR/cell_towers.json" ] && [ -f "$JSON_DIR/processing_stats.json" ]; then
    JSON_EXISTS=true
    
    # Check if data is recent (less than 7 days old)
    STATS_FILE="$JSON_DIR/processing_stats.json"
    if [ -f "$STATS_FILE" ]; then
        # Get file modification time in seconds since epoch
        FILE_TIME=$(stat -f %m "$STATS_FILE" 2>/dev/null || stat -c %Y "$STATS_FILE" 2>/dev/null)
        CURRENT_TIME=$(date +%s)
        AGE_DAYS=$(( (CURRENT_TIME - FILE_TIME) / 86400 ))
        
        if [ $AGE_DAYS -lt 7 ]; then
            SKIP_DOWNLOAD=true
            echo "📋 Found recent FCC data ($AGE_DAYS days old)"
            echo "⏭️  Skipping download - using existing data"
            echo "💡 Use --force to override: npm run fetch-towers-fcc -- --force"
            echo ""
        else
            echo "📋 Found old FCC data ($AGE_DAYS days old)"
            echo "🔄 Refreshing data..."
            echo ""
        fi
    fi
fi

if [ "$SKIP_DOWNLOAD" = false ]; then
    echo "📡 Fetching FCC tower data..."
    echo "📁 Target directory: $DATA_DIR"
    echo ""

    # Download each file
    for file in "${FILES[@]}"; do
        target_file="$DATA_DIR/$file"
        
        # Check if file already exists and is not too old
        if [ -f "$target_file" ]; then
            FILE_TIME=$(stat -f %m "$target_file" 2>/dev/null || stat -c %Y "$target_file" 2>/dev/null)
            CURRENT_TIME=$(date +%s)
            AGE_DAYS=$(( (CURRENT_TIME - FILE_TIME) / 86400 ))
            
            if [ $AGE_DAYS -lt 7 ]; then
                echo "⏭️  Skipping $file (exists, $AGE_DAYS days old)"
                echo ""
                continue
            else
                echo "🔄 Refreshing $file (old, $AGE_DAYS days old)"
            fi
        fi
        
        echo "⬇️  Downloading $file..."
        curl -o "$target_file" "$FTP_BASE_URL/$file"
        
        # Check if download was successful
        if [ $? -eq 0 ]; then
            echo "✅ Successfully downloaded $file"
            echo "📊 Size: $(du -h "$target_file" | cut -f1)"
        else
            echo "❌ Failed to download $file"
            exit 1
        fi
        echo ""
    done

    echo "📦 Extracting ZIP files..."
    for file in "${FILES[@]}"; do
        basename=$(basename "$file" .zip)
        target_zip="$DATA_DIR/$file"
        target_extract="$EXTRACTED_DIR/$basename"
        
        if [ -f "$target_zip" ]; then
            echo "🗂️  Extracting $file to $target_extract..."
            rm -rf "$target_extract"  # Clean previous extraction
            mkdir -p "$target_extract"
            unzip -q "$target_zip" -d "$target_extract/"
            echo "✅ Extracted $file"
        fi
    done

    echo ""
    echo "🔄 Processing and converting to JSON..."

    # Check if Node.js is available
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js is required for data processing"
        exit 1
    fi

    # Run the Node.js processor
    node scripts/process_fcc_data.cjs "$EXTRACTED_DIR" "$JSON_DIR"
fi

echo ""
echo "🎉 FCC tower data processing complete!"
echo "📂 Raw data: $EXTRACTED_DIR"
echo "📋 JSON data: $JSON_DIR"
echo ""

# Show summary
echo "� Processed Files Summary:"
ls -lh "$JSON_DIR"/*.json 2>/dev/null || echo "No JSON files found"
echo ""

echo "💡 Usage:"
echo "   - Cell towers: $JSON_DIR/cell_towers.json"
echo "   - All towers: $JSON_DIR/all_towers.json"
echo "   - Processed locations: $JSON_DIR/locations.json"
