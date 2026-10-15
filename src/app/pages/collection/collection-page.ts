import { Component, Input, ViewEncapsulation } from '@angular/core';
import type { App } from '../../app';
import { CollectionCardTile } from '../../components/collection-card-tile/collection-card-tile';
import { LucidePlus, LucideLibrary, LucideCircleAlert, LucideRotateCw, LucideArrowDownUp, LucideArrowUpRight, LucideSearch, LucideShieldCheck } from '@lucide/angular';

@Component({
  selector: 'app-collection-page',
  standalone: true,
  imports: [CollectionCardTile, LucidePlus, LucideLibrary, LucideCircleAlert, LucideRotateCw, LucideArrowDownUp, LucideArrowUpRight, LucideSearch, LucideShieldCheck],
  templateUrl: './collection-page.html',
  styleUrl: './collection-page.css',
  encapsulation: ViewEncapsulation.None,
})
export class CollectionPage {
  @Input({ required: true }) context!: App;
}
