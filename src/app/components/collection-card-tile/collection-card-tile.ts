import { Component, Input, ViewEncapsulation } from '@angular/core';
import type { App } from '../../app';
import { CollectionCard } from '../../interfaces/collection-card';
import { LucideLayers } from '@lucide/angular';

@Component({
  selector: 'app-collection-card-tile',
  standalone: true,
  imports: [LucideLayers],
  templateUrl: './collection-card-tile.html',
  encapsulation: ViewEncapsulation.None,
})
export class CollectionCardTile {
  @Input({ required: true }) card!: CollectionCard;
  @Input({ required: true }) context!: App;
  @Input() showUnsortedState = false;
}
