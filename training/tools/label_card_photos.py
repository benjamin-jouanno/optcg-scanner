"""Small desktop helper for labeling real card photos for model training."""

from __future__ import annotations

import json
import re
import shutil
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from PIL import Image, ImageOps, ImageTk


TRAINING_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = TRAINING_ROOT / "data" / "cards"
SUPPORTED_TYPES = (".jpg", ".jpeg", ".png", ".webp")
MAX_CAMERA_PHOTOS = 200
CAMERA_CAPTURE_ROOT = TRAINING_ROOT / "data" / "camera-captures"


class CardPhotoLabeler:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("One Piece Card Photo Labeler")
        self.root.geometry("1120x760")
        self.root.minsize(900, 640)

        self.files: list[Path] = []
        self.labels: list[dict | None] = []
        self.current_index: int | None = None
        self.preview_image = None
        self.camera_capture_count = 0
        self.output_dir = tk.StringVar(value=str(DEFAULT_OUTPUT))
        self.card_name = tk.StringVar()
        self.base_code = tk.StringVar()
        self.is_alternate = tk.BooleanVar(value=False)
        self.variant_suffix = tk.StringVar()
        self.generated_code = tk.StringVar(value="Code d’impression : —")
        self.status = tk.StringVar(value="Ajoute des photos, puis renseigne la carte de chaque image.")

        self._build_ui()
        self._watch_code_fields()

    def _build_ui(self):
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        header = ttk.Frame(self.root, padding=(18, 14, 18, 8))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text="Label card photos", font=("Segoe UI", 17, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(
            header,
            text="Label each physical-card photo. The exporter groups images in the folders used by train_model.py.",
        ).grid(row=1, column=0, sticky="w", pady=(4, 0))
        header_actions = ttk.Frame(header)
        header_actions.grid(row=0, column=1, rowspan=2, padx=(12, 0))
        ttk.Button(header_actions, text="Take photos with webcam…", command=self.open_camera_capture).grid(row=0, column=0, padx=(0, 6))
        ttk.Button(header_actions, text="Upload photos…", command=self.add_photos).grid(row=0, column=1)

        body = ttk.Frame(self.root, padding=(18, 4, 18, 12))
        body.grid(row=1, column=0, sticky="nsew")
        body.columnconfigure(0, weight=1, minsize=250)
        body.columnconfigure(1, weight=2, minsize=350)
        body.columnconfigure(2, weight=1, minsize=270)
        body.rowconfigure(0, weight=1)

        files_frame = ttk.LabelFrame(body, text="Photos", padding=8)
        files_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        files_frame.rowconfigure(0, weight=1)
        files_frame.columnconfigure(0, weight=1)
        self.file_list = tk.Listbox(files_frame, exportselection=False, activestyle="dotbox")
        self.file_list.grid(row=0, column=0, sticky="nsew")
        self.file_list.bind("<<ListboxSelect>>", self._on_file_selected)
        list_scroll = ttk.Scrollbar(files_frame, orient="vertical", command=self.file_list.yview)
        list_scroll.grid(row=0, column=1, sticky="ns")
        self.file_list.configure(yscrollcommand=list_scroll.set)
        ttk.Label(files_frame, text="✓ = labeled").grid(row=1, column=0, sticky="w", pady=(7, 0))

        preview_frame = ttk.LabelFrame(body, text="Selected photo", padding=8)
        preview_frame.grid(row=0, column=1, sticky="nsew", padx=8)
        preview_frame.rowconfigure(0, weight=1)
        preview_frame.columnconfigure(0, weight=1)
        self.preview = ttk.Label(preview_frame, text="Select a photo to preview it", anchor="center")
        self.preview.grid(row=0, column=0, sticky="nsew")
        self.photo_caption = ttk.Label(preview_frame, text="")
        self.photo_caption.grid(row=1, column=0, sticky="ew", pady=(6, 0))

        form = ttk.LabelFrame(body, text="Card details for this photo", padding=12)
        form.grid(row=0, column=2, sticky="nsew", padx=(8, 0))
        form.columnconfigure(0, weight=1)
        ttk.Label(form, text="Card name").grid(row=0, column=0, sticky="w")
        ttk.Entry(form, textvariable=self.card_name).grid(row=1, column=0, sticky="ew", pady=(3, 12))
        ttk.Label(form, text="Base card number (set-number)").grid(row=2, column=0, sticky="w")
        ttk.Entry(form, textvariable=self.base_code).grid(row=3, column=0, sticky="ew", pady=(3, 5))
        ttk.Label(form, text="Example: ST10-008").grid(row=4, column=0, sticky="w")
        ttk.Checkbutton(form, text="Alternative art / printing", variable=self.is_alternate, command=self._update_code).grid(row=5, column=0, sticky="w", pady=(16, 4))
        ttk.Label(form, text="Printing suffix (without _ or -)").grid(row=6, column=0, sticky="w")
        ttk.Entry(form, textvariable=self.variant_suffix).grid(row=7, column=0, sticky="ew", pady=(3, 5))
        ttk.Label(form, text="Example: r1 or p1").grid(row=8, column=0, sticky="w")
        ttk.Label(form, textvariable=self.generated_code, font=("Segoe UI", 9, "bold")).grid(row=9, column=0, sticky="w", pady=(12, 8))
        ttk.Button(form, text="Copy label from previous photo", command=self.copy_previous_label).grid(row=10, column=0, sticky="ew", pady=(4, 0))
        ttk.Separator(form).grid(row=11, column=0, sticky="ew", pady=14)
        nav = ttk.Frame(form)
        nav.grid(row=12, column=0, sticky="ew")
        nav.columnconfigure((0, 1), weight=1)
        ttk.Button(nav, text="← Previous", command=lambda: self.navigate(-1)).grid(row=0, column=0, sticky="ew", padx=(0, 4))
        ttk.Button(nav, text="Save and next →", command=lambda: self.navigate(1)).grid(row=0, column=1, sticky="ew", padx=(4, 0))

        footer = ttk.Frame(self.root, padding=(18, 0, 18, 16))
        footer.grid(row=2, column=0, sticky="ew")
        footer.columnconfigure(1, weight=1)
        ttk.Label(footer, text="Dataset folder").grid(row=0, column=0, sticky="w", padx=(0, 8))
        ttk.Entry(footer, textvariable=self.output_dir).grid(row=0, column=1, sticky="ew")
        ttk.Button(footer, text="Browse…", command=self.choose_output).grid(row=0, column=2, padx=(8, 0))
        ttk.Button(footer, text="Build training folders", command=self.export_dataset).grid(row=0, column=3, padx=(12, 0))
        ttk.Label(footer, textvariable=self.status).grid(row=1, column=0, columnspan=4, sticky="w", pady=(10, 0))

    def _watch_code_fields(self):
        self.base_code.trace_add("write", lambda *_: self._update_code())
        self.variant_suffix.trace_add("write", lambda *_: self._update_code())
        self.is_alternate.trace_add("write", lambda *_: self._update_code())

    def _build_code(self) -> str:
        base = re.sub(r"\s+", "", self.base_code.get()).upper()
        if not base:
            return ""
        if self.is_alternate.get():
            suffix = re.sub(r"^[-_]+", "", self.variant_suffix.get().strip()).upper()
            return f"{base}_{suffix}" if suffix else ""
        return base

    def _update_code(self):
        code = self._build_code()
        self.generated_code.set(f"Code d’impression : {code or '—'}")
        self._update_list_entry()

    def add_photos(self):
        selected = filedialog.askopenfilenames(
            title="Choose card photos",
            filetypes=[("Card photos", "*.jpg *.jpeg *.png *.webp"), ("All files", "*.*")],
        )
        existing = {path.resolve() for path in self.files}
        for filename in selected:
            path = Path(filename)
            if path.suffix.lower() in SUPPORTED_TYPES and path.resolve() not in existing:
                self.files.append(path)
                self.labels.append(None)
                existing.add(path.resolve())
        self._refresh_list()
        if self.current_index is None and self.files:
            self._select_index(0)
        self.status.set(f"{len(self.files)} photo(s) loaded. Label them one at a time; same-card photos can reuse the previous label.")

    def open_camera_capture(self):
        remaining = MAX_CAMERA_PHOTOS - self.camera_capture_count
        if remaining <= 0:
            messagebox.showinfo("Capture limit reached", f"You have already taken {MAX_CAMERA_PHOTOS} photos in this session.")
            return
        try:
            import cv2
        except ImportError:
            messagebox.showerror(
                "Webcam support is missing",
                "Install the training requirements, including OpenCV, then restart this app:\n\npython -m pip install -r training\\requirements.txt",
            )
            return

        self._save_current_fields()
        capture = cv2.VideoCapture(0, cv2.CAP_DSHOW) if hasattr(cv2, "CAP_DSHOW") else cv2.VideoCapture(0)
        if not capture.isOpened():
            capture.release()
            messagebox.showerror("Could not open webcam", "Check that your webcam is connected and not being used by another app.")
            return
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)

        session_dir = CAMERA_CAPTURE_ROOT / datetime.now().strftime("%Y%m%d-%H%M%S")
        session_dir.mkdir(parents=True, exist_ok=True)
        window = tk.Toplevel(self.root)
        window.title("Take card photos")
        window.geometry("980x720")
        window.minsize(720, 520)
        window.transient(self.root)
        window.grab_set()
        window.columnconfigure(0, weight=1)
        window.rowconfigure(0, weight=1)

        preview = ttk.Label(window, text="Starting webcam…", anchor="center")
        preview.grid(row=0, column=0, sticky="nsew", padx=12, pady=(12, 6))
        counter = tk.StringVar(value=f"0 / {remaining} photos captured (200 max for this app session)")
        ttk.Label(window, textvariable=counter).grid(row=1, column=0, pady=(0, 8))
        controls = ttk.Frame(window, padding=(12, 0, 12, 12))
        controls.grid(row=2, column=0, sticky="ew")
        controls.columnconfigure((0, 1, 2, 3), weight=1)

        rotation = 0
        current_frame = None
        photo_reference = None
        captured_paths: list[Path] = []
        is_closed = False

        def rotate_left():
            nonlocal rotation
            rotation = (rotation - 90) % 360

        def rotate_right():
            nonlocal rotation
            rotation = (rotation + 90) % 360

        def close_capture():
            nonlocal is_closed
            if is_closed:
                return
            is_closed = True
            capture.release()
            window.destroy()
            if captured_paths:
                existing = {path.resolve() for path in self.files}
                for path in captured_paths:
                    if path.resolve() not in existing:
                        self.files.append(path)
                        self.labels.append(None)
                        existing.add(path.resolve())
                self._refresh_list()
                if self.current_index is None and self.files:
                    self._select_index(0)
                self.status.set(f"Added {len(captured_paths)} webcam photo(s) to the labeling queue. Reuse the previous label for more views of the same card.")
            else:
                self.status.set("Webcam closed without taking any photos.")

        def take_photo():
            nonlocal current_frame
            if current_frame is None:
                return
            if self.camera_capture_count >= MAX_CAMERA_PHOTOS:
                messagebox.showinfo("Capture limit reached", f"The limit is {MAX_CAMERA_PHOTOS} webcam photos per app session.", parent=window)
                return
            path = session_dir / f"card_{self.camera_capture_count + 1:03d}.jpg"
            Image.fromarray(current_frame).save(path, format="JPEG", quality=95, optimize=True)
            captured_paths.append(path)
            self.camera_capture_count += 1
            count = len(captured_paths)
            counter.set(f"{count} / {remaining} photos captured · {self.camera_capture_count} / {MAX_CAMERA_PHOTOS} session total")
            if self.camera_capture_count >= MAX_CAMERA_PHOTOS:
                capture_button.configure(state="disabled")

        def refresh_preview():
            nonlocal current_frame, photo_reference
            if is_closed:
                return
            ok, frame = capture.read()
            if ok:
                if rotation == 90:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
                elif rotation == 180:
                    frame = cv2.rotate(frame, cv2.ROTATE_180)
                elif rotation == 270:
                    frame = cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
                current_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image = Image.fromarray(current_frame)
                image.thumbnail((920, 570), Image.Resampling.LANCZOS)
                photo_reference = ImageTk.PhotoImage(image)
                preview.configure(image=photo_reference, text="")
            else:
                preview.configure(text="No webcam image received. Check the camera connection.")
            window.after(30, refresh_preview)

        ttk.Button(controls, text="↶ Rotate left 90°", command=rotate_left).grid(row=0, column=0, sticky="ew", padx=(0, 5))
        ttk.Button(controls, text="↷ Rotate right 90°", command=rotate_right).grid(row=0, column=1, sticky="ew", padx=5)
        capture_button = ttk.Button(controls, text="Take photo", command=take_photo)
        capture_button.grid(row=0, column=2, sticky="ew", padx=5)
        ttk.Button(controls, text="Done — label photos", command=close_capture).grid(row=0, column=3, sticky="ew", padx=(5, 0))
        window.protocol("WM_DELETE_WINDOW", close_capture)
        window.after(0, refresh_preview)

    def _refresh_list(self):
        current = self.current_index
        self.file_list.delete(0, tk.END)
        for index, path in enumerate(self.files):
            marker = "✓ " if self._is_complete(self.labels[index]) else "○ "
            self.file_list.insert(tk.END, marker + path.name)
        if current is not None and current < len(self.files):
            self.file_list.selection_set(current)
            self.file_list.activate(current)

    def _on_file_selected(self, _event=None):
        selection = self.file_list.curselection()
        if not selection:
            return
        index = selection[0]
        if index == self.current_index:
            return
        self._save_current_fields()
        self.current_index = index
        self._load_current()

    def _select_index(self, index: int):
        if not self.files:
            return
        self._save_current_fields()
        index = max(0, min(index, len(self.files) - 1))
        self.current_index = index
        self.file_list.selection_clear(0, tk.END)
        self.file_list.selection_set(index)
        self.file_list.activate(index)
        self.file_list.see(index)
        self._load_current()

    def _load_current(self):
        if self.current_index is None:
            return
        path = self.files[self.current_index]
        label = self.labels[self.current_index] or {}
        self.card_name.set(label.get("name", ""))
        self.base_code.set(label.get("base_code", ""))
        self.is_alternate.set(bool(label.get("alternate_art", False)))
        self.variant_suffix.set(label.get("suffix", ""))
        self.photo_caption.configure(text=f"Photo {self.current_index + 1} of {len(self.files)} · {path.name}")
        try:
            with Image.open(path) as opened:
                image = ImageOps.exif_transpose(opened).convert("RGB")
                image.thumbnail((560, 540), Image.Resampling.LANCZOS)
                self.preview_image = ImageTk.PhotoImage(image)
            self.preview.configure(image=self.preview_image, text="")
        except (OSError, Image.UnidentifiedImageError) as error:
            self.preview.configure(image="", text=f"Could not preview this image:\n{error}")
            self.preview_image = None
        self._update_code()

    def _save_current_fields(self):
        if self.current_index is None:
            return
        self.labels[self.current_index] = {
            "name": self.card_name.get().strip(),
            "base_code": re.sub(r"\s+", "", self.base_code.get()).upper(),
            "alternate_art": self.is_alternate.get(),
            "suffix": re.sub(r"^[-_]+", "", self.variant_suffix.get().strip()).upper(),
        }
        self._update_list_entry()

    @staticmethod
    def _is_complete(label: dict | None) -> bool:
        if not label or not label.get("name") or not label.get("base_code"):
            return False
        if label.get("alternate_art") and not label.get("suffix"):
            return False
        return bool(re.fullmatch(r"[A-Z0-9]+[-_][A-Z0-9]+", label["base_code"]))

    def _update_list_entry(self):
        if self.current_index is None or self.current_index >= self.file_list.size():
            return
        marker = "✓ " if self._is_complete({
            "name": self.card_name.get().strip(),
            "base_code": re.sub(r"\s+", "", self.base_code.get()).upper(),
            "alternate_art": self.is_alternate.get(),
            "suffix": self.variant_suffix.get().strip(),
        }) else "○ "
        self.file_list.delete(self.current_index)
        self.file_list.insert(self.current_index, marker + self.files[self.current_index].name)
        self.file_list.selection_set(self.current_index)

    def copy_previous_label(self):
        if self.current_index is None or self.current_index == 0:
            self.status.set("There is no previous photo to copy from.")
            return
        self._save_current_fields()
        previous = self.labels[self.current_index - 1]
        if not self._is_complete(previous):
            self.status.set("Label the previous photo first, then copy its label.")
            return
        self.card_name.set(previous["name"])
        self.base_code.set(previous["base_code"])
        self.is_alternate.set(previous["alternate_art"])
        self.variant_suffix.set(previous["suffix"])
        self._save_current_fields()
        self.status.set("Copied the previous photo’s card label. Adjust it if this printing is different.")

    def navigate(self, delta: int):
        if self.current_index is None:
            return
        self._save_current_fields()
        self._refresh_list()
        self._select_index(self.current_index + delta)

    def choose_output(self):
        selected = filedialog.askdirectory(title="Choose the training data/cards folder", initialdir=self.output_dir.get())
        if selected:
            self.output_dir.set(selected)

    def export_dataset(self):
        self._save_current_fields()
        incomplete = [index + 1 for index, label in enumerate(self.labels) if not self._is_complete(label)]
        if incomplete:
            messagebox.showerror("Photos still need labels", f"Complete the card details for photo(s): {', '.join(map(str, incomplete[:12]))}")
            return
        if not self.files:
            messagebox.showinfo("No photos", "Add photos before building the training folders.")
            return

        name_by_code: dict[str, str] = {}
        for label in self.labels:
            code = self._build_labeled_code(label)
            previous_name = name_by_code.setdefault(code, label["name"])
            if previous_name != label["name"]:
                messagebox.showerror("Conflicting card names", f"The code {code} has more than one name. Correct the labels before exporting.")
                return

        output = Path(self.output_dir.get()).expanduser()
        try:
            output.mkdir(parents=True, exist_ok=True)
            groups: dict[str, list[tuple[Path, dict]]] = {}
            for image_path, label in zip(self.files, self.labels):
                code = self._build_labeled_code(label)
                groups.setdefault(code, []).append((image_path, label))

            for code, records in groups.items():
                card_folder = output / code
                manifest_path = card_folder / "card.json"
                if manifest_path.exists():
                    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                    if manifest.get("code") != code or manifest.get("name") != records[0][1]["name"]:
                        raise ValueError(f"Existing card.json conflicts with the new label for {code}.")

            copied = 0
            for code, records in groups.items():
                card_folder = output / code
                card_folder.mkdir(parents=True, exist_ok=True)
                manifest_path = card_folder / "card.json"
                if not manifest_path.exists():
                    manifest = {
                        "code": code,
                        "name": records[0][1]["name"],
                        "alternateArt": records[0][1]["alternate_art"],
                    }
                    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                for image_path, _label in records:
                    extension = image_path.suffix.lower()
                    destination = card_folder / f"photo_{copied + 1:05d}{extension}"
                    while destination.exists():
                        copied += 1
                        destination = card_folder / f"photo_{copied + 1:05d}{extension}"
                    shutil.copy2(image_path, destination)
                    copied += 1

            self.status.set(f"Exported {copied} photo(s) for {len(groups)} printing(s) to {output}")
            messagebox.showinfo("Dataset ready", f"Copied {copied} photo(s) into {len(groups)} card folder(s):\n{output}")
        except (OSError, ValueError, json.JSONDecodeError) as error:
            messagebox.showerror("Could not build dataset", str(error))

    @staticmethod
    def _build_labeled_code(label: dict) -> str:
        base = label["base_code"].upper()
        if label["alternate_art"]:
            return f"{base}_{label['suffix'].upper()}"
        return base


def main():
    root = tk.Tk()
    CardPhotoLabeler(root)
    root.mainloop()


if __name__ == "__main__":
    main()
