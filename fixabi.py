import json
import os

# Define the target directory relative to the script's location
abis_dir = "src/abis"
# Assuming the script is run from the workspace root
workspace_root = os.getcwd()
target_dir_path = os.path.join(workspace_root, abis_dir)

# Check if the directory exists
if not os.path.isdir(target_dir_path):
    print(f"Error: Directory not found - {target_dir_path}")
    print("Please ensure you are running this script from the workspace root directory.")
    exit()

print(f"Formatting JSON files in: {target_dir_path}")

# Iterate over files in the directory
for filename in os.listdir(target_dir_path):
    if filename.endswith(".json"):
        file_path = os.path.join(target_dir_path, filename)
        print(f"  Processing {filename}...")
        try:
            # Read the possibly minified/single-line JSON content
            with open(file_path, 'r', encoding='utf-8') as f:
                # Handle potential BOM (Byte Order Mark) at the start of the file
                content = f.read()
                if content.startswith('\ufeff'):
                    content = content[1:]
                data = json.loads(content) # Use loads to handle string content

            # Write the data back, pretty-printed with 2-space indent
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            print(f"  Successfully formatted {filename}")

        except json.JSONDecodeError:
            print(f"  Error: Could not decode JSON from {filename}. Skipping.")
        except Exception as e:
            print(f"  An unexpected error occurred while processing {filename}: {e}. Skipping.")

print("\nFinished formatting JSON files.")
