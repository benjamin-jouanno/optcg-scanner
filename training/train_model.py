"""Train a MobileNetV3 card-image embedder and export it plus a card gallery."""

from __future__ import annotations

import argparse
import json
import os
import random
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=48)
    parser.add_argument("--learning-rate", type=float, default=0.00025)
    parser.add_argument("--temperature", type=float, default=0.09)
    parser.add_argument("--seed", type=int, default=42)
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
    model = CardEmbedder().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.0001)
    for epoch in range(args.epochs):
        model.train()
        total_loss = 0.0
        for first, second, codes in loader:
            first, second = first.to(device), second.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = contrastive_loss(model(first), model(second), codes, args.temperature)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        print(f"Epoch {epoch + 1}/{args.epochs}: contrastive_loss={total_loss / len(loader):.4f}")

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
