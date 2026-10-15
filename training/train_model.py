"""Train a MobileNetV3 card-image embedder and export it plus a card gallery."""

from __future__ import annotations

import argparse
import json
import os
import random
import time
from collections import defaultdict
from pathlib import Path

# Keep model downloads inside the project workspace instead of writing under the user profile.
ROOT = Path(__file__).resolve().parent
os.environ.setdefault("TORCH_HOME", str(ROOT / ".cache" / "torch"))

import torch
from PIL import Image, UnidentifiedImageError
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms


DATASET = ROOT / "data" / "cards"
OUTPUT = ROOT.parent / "public" / "assets" / "card-model"
DEFAULT_CHECKPOINT = ROOT / "checkpoints" / "one-piece-cards.checkpoint.pt"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


def read_image(path: Path):
    with Image.open(path) as opened:
        return opened.convert("RGB")


class TwoViewDataset(Dataset):
    def __init__(self, items, transform):
        self.items = items
        self.transform = transform

    def __len__(self):
        return len(self.items)

    def __getitem__(self, index):
        code, _, path = self.items[index]
        image = read_image(path)
        return self.transform(image), self.transform(image), code


class CardEmbedder(nn.Module):
    def __init__(self, pretrained=True):
        super().__init__()
        weights = models.MobileNet_V3_Small_Weights.DEFAULT if pretrained else None
        backbone = models.mobilenet_v3_small(weights=weights)
        self.features = backbone.features
        # Keep the pretrained visual backbone fixed. With one catalog image per
        # printing, training the projection is both faster and less prone to
        # memorizing the catalog than fine-tuning the whole network.
        for parameter in self.features.parameters():
            parameter.requires_grad = False
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.project = nn.Sequential(
            nn.Linear(backbone.classifier[0].in_features, 256),
            nn.Hardswish(),
            nn.Dropout(0.1),
            nn.Linear(256, 128),
        )

    def forward(self, image):
        with torch.no_grad():
            features = self.pool(self.features(image)).flatten(1)
        return F.normalize(self.project(features), p=2, dim=1)


def collect_items():
    items = []
    for folder in sorted(DATASET.iterdir()):
        metadata_path = folder / "card.json"
        if not folder.is_dir() or not metadata_path.exists():
            continue
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        code = str(metadata.get("code", folder.name))
        name = str(metadata.get("name", code))
        for path in sorted(folder.iterdir()):
            if path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            try:
                with Image.open(path) as image:
                    image.verify()
                items.append((code, name, path))
            except (OSError, UnidentifiedImageError):
                print(f"Skipping invalid image: {path}")
    if len({item[0] for item in items}) < 2:
        raise SystemExit(f"Need reference images for at least two cards in {DATASET}.")
    return items


def contrastive_loss(first, second, codes, temperature=0.09):
    batch = first.shape[0]
    embeddings = torch.cat((first, second), dim=0)
    labels = list(codes) + list(codes)
    similarities = embeddings @ embeddings.T / temperature
    valid = ~torch.eye(batch * 2, dtype=torch.bool, device=embeddings.device)
    positive = torch.tensor([[left == right for right in labels] for left in labels], dtype=torch.bool, device=embeddings.device) & valid
    logits = similarities.masked_fill(~valid, -1e9)
    log_probabilities = logits - torch.logsumexp(logits, dim=1, keepdim=True)
    return -((log_probabilities * positive).sum(dim=1) / positive.sum(dim=1).clamp_min(1)).mean()


def save_checkpoint(path: Path, model, optimizer, completed_epochs: int, args, items):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(path.name + ".tmp")
    checkpoint = {
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "completed_epochs": completed_epochs,
        "learning_rate": args.learning_rate,
        "temperature": args.temperature,
        "training_images": len(items),
        "card_printings": len({item[0] for item in items}),
    }
    torch.save(checkpoint, temporary_path)
    os.replace(temporary_path, path)


def format_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"


def show_batch_progress(epoch: int, total_epochs: int, batch: int, total_batches: int, loss: float, started_at: float):
    elapsed = time.monotonic() - started_at
    batches_done = batch
    average_batch_time = elapsed / max(1, batches_done)
    eta = average_batch_time * (total_batches - batches_done)
    percent = batches_done / max(1, total_batches)
    width = 24
    filled = int(width * percent)
    bar = "#" * filled + "." * (width - filled)
    message = (
        f"Epoch {epoch}/{total_epochs} [{bar}] {batches_done}/{total_batches} "
        f"{percent:5.1%} | loss {loss:.4f} | elapsed {format_duration(elapsed)} | ETA {format_duration(eta)}"
    )
    print(f"\r{message:<120}", end="", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=48)
    parser.add_argument("--learning-rate", type=float, default=0.00025)
    parser.add_argument("--temperature", type=float, default=0.09)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--fresh", action="store_true", help="Ignore any saved checkpoint and start from ImageNet weights.")
    args = parser.parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)

    items = collect_items()
    train_transform = transforms.Compose([
        transforms.Resize((256, 256)),
        transforms.RandomResizedCrop(224, scale=(0.72, 1.0), ratio=(0.62, 0.78)),
        transforms.RandomPerspective(distortion_scale=0.18, p=0.5),
        transforms.RandomRotation(10),
        transforms.ColorJitter(brightness=0.32, contrast=0.30, saturation=0.24, hue=0.03),
        transforms.RandomApply([transforms.GaussianBlur(kernel_size=3, sigma=(0.1, 1.8))], p=0.25),
        transforms.ToTensor(),
        transforms.Normalize(MEAN, STD),
    ])
    eval_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(MEAN, STD),
    ])
    loader = DataLoader(TwoViewDataset(items, train_transform), batch_size=args.batch_size, shuffle=True, drop_last=True, num_workers=0)
    if not len(loader):
        raise SystemExit("Not enough card images for one training batch; lower --batch-size.")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Training set: {len(items)} images across {len({item[0] for item in items})} printings")
    print(f"Device: {device} | batches per epoch: {len(loader)} | epochs this run: {args.epochs}")
    resume = args.checkpoint.is_file() and not args.fresh
    model = CardEmbedder(pretrained=not resume).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.0001)
    completed_epochs = 0
    if resume:
        checkpoint = torch.load(args.checkpoint, map_location=device, weights_only=True)
        model.load_state_dict(checkpoint["model_state_dict"])
        optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        # Keep the command-line learning rate authoritative when resuming.
        for parameter_group in optimizer.param_groups:
            parameter_group["lr"] = args.learning_rate
        completed_epochs = int(checkpoint.get("completed_epochs", 0))
        print(f"Resuming checkpoint after {completed_epochs} completed epochs: {args.checkpoint}")
    else:
        print("Starting from ImageNet MobileNetV3 weights and a new projection head.")

    run_total_epochs = completed_epochs + args.epochs
    for session_epoch in range(args.epochs):
        model.train()
        total_loss = 0.0
        epoch_started_at = time.monotonic()
        for batch_index, (first, second, codes) in enumerate(loader, start=1):
            first, second = first.to(device), second.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = contrastive_loss(model(first), model(second), codes, args.temperature)
            loss.backward()
            optimizer.step()
            batch_loss = loss.item()
            total_loss += batch_loss
            show_batch_progress(completed_epochs + 1, run_total_epochs, batch_index, len(loader), batch_loss, epoch_started_at)
        completed_epochs += 1
        print()
        save_checkpoint(args.checkpoint, model, optimizer, completed_epochs, args, items)
        print(f"Epoch complete: mean contrastive loss={total_loss / len(loader):.4f} | checkpoint saved")

    model.eval().cpu()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    model_path = OUTPUT / "one-piece-cards.onnx"
    torch.onnx.export(
        model,
        torch.zeros(1, 3, 224, 224),
        model_path,
        input_names=["image"],
        output_names=["embedding"],
        dynamic_axes={"image": {0: "batch"}, "embedding": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )

    gallery = defaultdict(list)
    with torch.inference_mode():
        for code, name, path in items:
            image = eval_transform(read_image(path)).unsqueeze(0)
            vector = model(image)[0].tolist()
            gallery[code].append({"name": name, "vector": vector})
    gallery_payload = [{"code": code, "images": images} for code, images in sorted(gallery.items())]
    (OUTPUT / "gallery.json").write_text(json.dumps(gallery_payload, separators=(",", ":")), encoding="utf-8")
    (OUTPUT / "metadata.json").write_text(json.dumps({
        "model": "MobileNetV3 Small",
        "trainingImages": len(items),
        "cardPrintings": len(gallery),
        "embeddingSize": 128,
        "inputSize": 224,
        "normalization": {"mean": MEAN, "std": STD},
        "trainingObjective": "supervised contrastive learning with two augmented views per labeled printing",
    }, indent=2), encoding="utf-8")
    print(f"Exported {len(items)} images for {len(gallery)} printings to {OUTPUT}.")
    print("The validation target is real camera photos that were not used in training; synthetic augmentation loss is not a real-world accuracy score.")


if __name__ == "__main__":
    main()
