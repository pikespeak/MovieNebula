const colorMap = {
  movie: '#38bdf8',
  genre: '#a855f7',
  person: '#22c55e',
  keyword: '#f97316',
};

const svg = d3.select('#network');
const width = 1200;
const height = 800;

const linkStrengthInput = document.getElementById('linkStrength');
const filterInput = document.getElementById('nodeFilter');
const jsonFileInput = document.getElementById('jsonFile');
const zoomInButton = document.getElementById('zoomIn');
const zoomOutButton = document.getElementById('zoomOut');
const zoomResetButton = document.getElementById('zoomReset');
const zoomValue = document.getElementById('zoomValue');
const datasetInfo = document.getElementById('datasetInfo');
const listContainer = document.getElementById('simpleList');
const chartSelect = document.getElementById('chartType');
const layoutModeKey = 'movienebula.layoutMode';
const defaultLayoutMode = 'similarity';

let currentData = null;
let currentLayoutModeUpdater = null;

const createLayoutModeControl = () => {
  const controls = document.querySelector('.controls');
  if (!controls) return null;

  const label = document.createElement('label');
  label.className = 'layout-mode';
  label.textContent = 'Layout';

  const select = document.createElement('select');
  select.id = 'layoutMode';
  select.innerHTML = `
    <option value="similarity">Genre + Similarity</option>
    <option value="actor">Genre + Actor</option>
    <option value="year">Genre + Year</option>
  `;

  label.appendChild(select);
  controls.appendChild(label);
  return select;
};

const layoutModeInput = document.getElementById('layoutMode') ?? createLayoutModeControl();

if (layoutModeInput) {
  const savedMode = localStorage.getItem(layoutModeKey);
  if (savedMode) {
    layoutModeInput.value = savedMode;
  }
  layoutModeInput.addEventListener('change', () => {
    localStorage.setItem(layoutModeKey, layoutModeInput.value);
    if (currentLayoutModeUpdater) {
      currentLayoutModeUpdater(layoutModeInput.value);
    }
  });
}

const createGraph = (data) => {
  const nodes = [];
  const links = [];
  const nodeMap = new Map();

  const ensureNode = (id, label, type, meta = {}) => {
    if (nodeMap.has(id)) {
      return nodeMap.get(id);
    }
    const node = {
      id,
      label,
      type,
      ...meta,
    };
    nodeMap.set(id, node);
    nodes.push(node);
    return node;
  };

  const movieIds = new Set();
  const linkKeys = new Set();
  const addLink = (source, target, type) => {
    const key = `${source}|${target}|${type}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ source, target, type });
  };

  data.movies.forEach((movie) => {
    if (movieIds.has(movie.id)) return;
    movieIds.add(movie.id);

    const movieNode = ensureNode(`movie-${movie.id}`, movie.title, 'movie', {
      releaseDate: movie.release_date,
      runtime: movie.runtime,
    });

    movie.genres.forEach((genre) => {
      const genreNode = ensureNode(`genre-${genre.id}`, genre.name, 'genre');
      addLink(movieNode.id, genreNode.id, 'genre');
    });

    movie.cast.forEach((person) => {
      const personNode = ensureNode(`person-${person.id}`, person.name, 'person');
      addLink(movieNode.id, personNode.id, 'cast');
    });

    (movie.keywords ?? []).forEach((keyword) => {
      const keywordNode = ensureNode(`keyword-${keyword.id}`, keyword.name, 'keyword');
      addLink(movieNode.id, keywordNode.id, 'keyword');
    });
  });

  return { nodes, links };
};

const createMovieGraph = (data) => {
  const nodes = data.movies.map((movie) => {
    const releaseYear = Number(movie.release_date?.slice(0, 4));
    return {
      id: `movie-${movie.id}`,
      label: movie.title,
      type: 'movie',
      releaseDate: movie.release_date,
      runtime: movie.runtime,
      year: Number.isFinite(releaseYear) ? releaseYear : null,
      genreIds: movie.genres?.map((genre) => genre.id) ?? [],
      actorIds: movie.cast?.map((person) => person.id) ?? [],
      keywordIds: movie.keywords?.map((keyword) => keyword.id) ?? [],
    };
  });

  return { nodes, links: [] };
};

const buildGenreCenters = (nodes, centerX, centerY, radius) => {
  const uniqueGenres = [];
  const seen = new Set();
  nodes.forEach((node) => {
    (node.genreIds ?? []).forEach((genreId) => {
      if (seen.has(genreId)) return;
      seen.add(genreId);
      uniqueGenres.push(genreId);
    });
  });

  const centers = new Map();
  if (!uniqueGenres.length) {
    return centers;
  }

  uniqueGenres.forEach((genreId, index) => {
    const angle = (index / uniqueGenres.length) * Math.PI * 2;
    centers.set(genreId, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  return centers;
};

const forceGenreAttraction = (genreCenters, strength = 0.12) => {
  let nodes = [];
  const force = (alpha) => {
    for (const node of nodes) {
      if (!node.genreIds?.length) continue;
      let targetX = 0;
      let targetY = 0;
      let count = 0;
      for (const genreId of node.genreIds) {
        const center = genreCenters.get(genreId);
        if (!center) continue;
        targetX += center.x;
        targetY += center.y;
        count += 1;
      }
      if (!count) continue;
      targetX /= count;
      targetY /= count;
      node.vx += (targetX - node.x) * strength * alpha;
      node.vy += (targetY - node.y) * strength * alpha;
    }
  };
  force.initialize = (initNodes) => {
    nodes = initNodes;
  };
  return force;
};

const addWeightedAdjacency = (adjacency, aId, bId, weight) => {
  if (weight <= 0) return;
  const aMap = adjacency.get(aId) ?? new Map();
  aMap.set(bId, Math.max(aMap.get(bId) ?? 0, weight));
  adjacency.set(aId, aMap);
  const bMap = adjacency.get(bId) ?? new Map();
  bMap.set(aId, Math.max(bMap.get(aId) ?? 0, weight));
  adjacency.set(bId, bMap);
};

const buildTopLinks = (adjacency, maxLinksPerNode) => {
  const linkMap = new Map();
  for (const [id, neighbors] of adjacency) {
    const top = Array.from(neighbors.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxLinksPerNode);
    for (const [otherId, weight] of top) {
      const key = id < otherId ? `${id}|${otherId}` : `${otherId}|${id}`;
      linkMap.set(key, Math.max(linkMap.get(key) ?? 0, weight));
    }
  }

  return Array.from(linkMap.entries()).map(([key, weight]) => {
    const [source, target] = key.split('|');
    return { source, target, weight };
  });
};

const buildSimilarityLinks = (nodes, { maxLinksPerNode = 6 } = {}) => {
  const featureSets = new Map();
  const genreIndex = new Map();
  const keywordIndex = new Map();

  nodes.forEach((node) => {
    const features = [];
    (node.genreIds ?? []).forEach((genreId) => {
      features.push(`g:${genreId}`);
      const list = genreIndex.get(genreId) ?? [];
      list.push(node);
      genreIndex.set(genreId, list);
    });
    (node.keywordIds ?? []).forEach((keywordId) => {
      features.push(`k:${keywordId}`);
      const list = keywordIndex.get(keywordId) ?? [];
      list.push(node);
      keywordIndex.set(keywordId, list);
    });
    featureSets.set(node.id, new Set(features));
  });

  const adjacency = new Map();
  const jaccard = (setA, setB) => {
    if (!setA.size || !setB.size) return 0;
    const [small, large] = setA.size < setB.size ? [setA, setB] : [setB, setA];
    let intersection = 0;
    for (const value of small) {
      if (large.has(value)) intersection += 1;
    }
    const union = setA.size + setB.size - intersection;
    return union ? intersection / union : 0;
  };

  for (const node of nodes) {
    const candidates = new Set();
    (node.genreIds ?? []).forEach((genreId) => {
      (genreIndex.get(genreId) ?? []).forEach((candidate) => candidates.add(candidate));
    });
    (node.keywordIds ?? []).forEach((keywordId) => {
      (keywordIndex.get(keywordId) ?? []).forEach((candidate) => candidates.add(candidate));
    });
    candidates.delete(node);

    for (const other of candidates) {
      if (node.id >= other.id) continue;
      const score = jaccard(featureSets.get(node.id), featureSets.get(other.id));
      addWeightedAdjacency(adjacency, node.id, other.id, score);
    }
  }

  return buildTopLinks(adjacency, maxLinksPerNode);
};

const buildActorLinks = (nodes, { maxLinksPerNode = 6 } = {}) => {
  const actorIndex = new Map();
  nodes.forEach((node) => {
    (node.actorIds ?? []).forEach((actorId) => {
      const list = actorIndex.get(actorId) ?? [];
      list.push(node);
      actorIndex.set(actorId, list);
    });
  });

  const pairCounts = new Map();
  for (const list of actorIndex.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const aId = list[i].id;
        const bId = list[j].id;
        const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const adjacency = new Map();
  for (const [key, count] of pairCounts.entries()) {
    const [aId, bId] = key.split('|');
    const weight = Math.min(1, count / 2);
    addWeightedAdjacency(adjacency, aId, bId, weight);
  }

  return buildTopLinks(adjacency, maxLinksPerNode);
};

const updateInfo = (data) => {
  const fetchedAt = data.fetched_at ? new Date(data.fetched_at).toLocaleDateString('de-DE') : 'lokal';
  datasetInfo.textContent = `Datensatz: ${data.movies.length} Filme · ${fetchedAt}`;
};

const renderNetwork = (graph) => {
  svg.selectAll('*').remove();
  svg.style('display', 'block');

  const svgNode = svg.node();
  const svgRect = svgNode?.getBoundingClientRect();
  const layoutWidth = svgRect?.width || width;
  const layoutHeight = svgRect?.height || height;

  const zoomLayer = svg.append('g').attr('class', 'zoom-layer');
  const linkGroup = zoomLayer.append('g');
  const nodeGroup = zoomLayer.append('g');
  const labelGroup = zoomLayer.append('g');

  const minZoom = 0.01;
  const maxZoom = 1;
  const fitMaxZoom = 0.85;
  const updateZoomValue = (scale) => {
    if (!zoomValue) return;
    const percent = Math.round(scale * 100);
    zoomValue.textContent = `${percent}%`;
  };

  const zoom = d3
    .zoom()
    .scaleExtent([minZoom, maxZoom])
    .on('zoom', (event) => {
      zoomLayer.attr('transform', event.transform);
      updateZoomValue(event.transform.k);
    });

  svg.call(zoom);

  const centerX = layoutWidth / 2;
  const centerY = layoutHeight / 2;
  const useTypeClusters = false;
  const typeClusterOffsets = new Map([
    ['movie', { x: -80, y: -40 }],
    ['genre', { x: 80, y: -40 }],
    ['person', { x: -60, y: 60 }],
    ['keyword', { x: 60, y: 60 }],
  ]);

  const isMovieOnly = graph.nodes.every((node) => node.type === 'movie');
  const genreCenters = buildGenreCenters(
    graph.nodes,
    centerX,
    centerY,
    Math.min(layoutWidth, layoutHeight) * 0.18,
  );
  const simulation = d3
    .forceSimulation(graph.nodes)
    .velocityDecay(0.45)
    .alphaDecay(0.06)
    .force('charge', d3.forceManyBody().strength(-22).distanceMin(8).distanceMax(240))
    .force('center', d3.forceCenter(centerX, centerY))
    .force(
      'x',
      d3
        .forceX((d) =>
          useTypeClusters ? centerX + (typeClusterOffsets.get(d.type)?.x ?? 0) : centerX,
        )
        .strength(0.22),
    )
    .force(
      'y',
      d3
        .forceY((d) =>
          useTypeClusters ? centerY + (typeClusterOffsets.get(d.type)?.y ?? 0) : centerY,
        )
        .strength(0.22),
    )
    .force(
      'collide',
      d3
        .forceCollide()
        .radius((d) => (d.type === 'movie' ? 12 : 8))
        .strength(0.7)
        .iterations(1),
    )
    .force('genre', forceGenreAttraction(genreCenters, 0.12));

  let modeLinks = [];
  const cachedLinks = { similarity: null, actor: null };
  const updateLinkSelection = (links) => {
    modeLinks = links;
    const selection = linkGroup.selectAll('line').data(modeLinks, (d) => {
      const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
      const targetId = typeof d.target === 'object' ? d.target.id : d.target;
      return `${sourceId}|${targetId}`;
    });
    selection.exit().remove();
    selection.enter().append('line').attr('class', 'link');
  };

  const node = nodeGroup
    .selectAll('circle')
    .data(graph.nodes)
    .enter()
    .append('circle')
    .attr('class', 'node')
    .attr('r', (d) => (d.type === 'movie' ? 10 : 7))
    .attr('fill', (d) => colorMap[d.type])
    .call(
      d3
        .drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

  const label = labelGroup
    .selectAll('text')
    .data(graph.nodes)
    .enter()
    .append('text')
    .attr('class', 'label')
    .text((d) => d.label);

  const updateZoomToFit = () => {
    const bounds = zoomLayer.node().getBBox();
    if (!bounds.width || !bounds.height) return;

    const padding = 60;
    const viewWidth = svgRect?.width || width;
    const viewHeight = svgRect?.height || height;
    const scale = Math.min(
      fitMaxZoom,
      Math.max(
        minZoom,
        Math.min(
          viewWidth / (bounds.width + padding),
          viewHeight / (bounds.height + padding),
        ),
      ),
    );
    const translateX = viewWidth / 2 - (bounds.x + bounds.width / 2) * scale;
    const translateY = viewHeight / 2 - (bounds.y + bounds.height / 2) * scale;
    const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
    svg.call(zoom.transform, transform);
  };

  simulation.on('tick', () => {
    linkGroup
      .selectAll('line')
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);

    label.attr('x', (d) => d.x + 10).attr('y', (d) => d.y + 4);
  });

  simulation.on('end', updateZoomToFit);

  const zoomBy = (factor) => {
    svg.transition().duration(200).call(zoom.scaleBy, factor);
  };

  zoomInButton.onclick = () => zoomBy(1.2);
  zoomOutButton.onclick = () => zoomBy(0.8);
  zoomResetButton.onclick = updateZoomToFit;

  const getLinkStrength = () => {
    if (!linkStrengthInput) return 0.1;
    return Math.abs(Number(linkStrengthInput.value)) / 1000;
  };

  const updateFilter = () => {
    if (!filterInput) return;
    const filterValue = filterInput.value;
    node.attr('opacity', (d) => (d.type === filterValue ? 1 : 0));
    label.attr('opacity', (d) => (d.type === filterValue ? 1 : 0));
    linkGroup.selectAll('line').attr('opacity', (d) => {
      return d.source.type === filterValue && d.target.type === filterValue ? 0.6 : 0;
    });
  };

  const applyLayoutMode = (mode) => {
    const linkStrength = getLinkStrength();
    simulation.force('year', null);
    simulation.force('mode', null);

    if (mode === 'year') {
      updateLinkSelection([]);
      const years = graph.nodes.map((node) => node.year).filter((value) => Number.isFinite(value));
      const [minYear, maxYear] = d3.extent(years.length ? years : [2000, 2025]);
      const yearSpan = Math.min(layoutWidth, layoutHeight) * 0.2;
      const yearScale = d3
        .scaleLinear()
        .domain([minYear, maxYear])
        .range([centerX - yearSpan, centerX + yearSpan]);
      simulation.force(
        'year',
        d3
          .forceX((d) => (Number.isFinite(d.year) ? yearScale(d.year) : centerX))
          .strength(0.12),
      );
      if (linkStrengthInput) {
        linkStrengthInput.disabled = true;
      }
    } else {
      const cached = cachedLinks[mode];
      const links =
        cached ??
        (mode === 'actor'
          ? buildActorLinks(graph.nodes, { maxLinksPerNode: 6 })
          : buildSimilarityLinks(graph.nodes, { maxLinksPerNode: 6 }));
      if (!cached) {
        cachedLinks[mode] = links;
      }
      updateLinkSelection(links);
      simulation.force(
        'mode',
        d3
          .forceLink(links)
          .id((d) => d.id)
          .distance(mode === 'actor' ? 24 : 28)
          .strength((link) => linkStrength * (0.4 + 0.6 * (link.weight ?? 1))),
      );
      if (linkStrengthInput) {
        linkStrengthInput.disabled = false;
      }
    }

    simulation.alpha(0.6).restart();
  };

  const updateLinkStrength = () => {
    if (!currentLayoutModeUpdater) return;
    currentLayoutModeUpdater(layoutModeInput?.value ?? defaultLayoutMode);
  };

  if (filterInput) {
    filterInput.onchange = updateFilter;
  }
  if (linkStrengthInput) {
    linkStrengthInput.oninput = updateLinkStrength;
  }

  if (isMovieOnly && filterInput) {
    filterInput.value = 'movie';
    filterInput.disabled = true;
  }
  if (!isMovieOnly && filterInput) {
    filterInput.disabled = false;
  }

  currentLayoutModeUpdater = applyLayoutMode;
  applyLayoutMode(layoutModeInput?.value ?? defaultLayoutMode);
  updateFilter();
  updateZoomToFit();
};

const getSvgSize = () => {
  const rect = svg.node()?.getBoundingClientRect();
  return {
    width: rect?.width || width,
    height: rect?.height || height,
  };
};

const renderList = (data) => {
  if (!listContainer) return;
  listContainer.innerHTML = '';
  listContainer.style.display = 'grid';
  svg.style('display', 'none');

  const heading = document.createElement('h3');
  heading.textContent = 'Filmliste (Runtime)';
  listContainer.appendChild(heading);

  const list = document.createElement('ul');
  data.movies.forEach((movie) => {
    const item = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = movie.title;
    const runtime = document.createElement('span');
    runtime.className = 'runtime';
    runtime.textContent = movie.runtime ? `${movie.runtime} min` : 'n/a';
    item.appendChild(title);
    item.appendChild(runtime);
    list.appendChild(item);
  });
  listContainer.appendChild(list);
};

const styleAxis = (axisGroup) => {
  axisGroup.selectAll('path, line').attr('stroke', '#475569');
  axisGroup.selectAll('text').attr('fill', '#cbd5f5');
};

const renderGenresBar = (data) => {
  if (listContainer) {
    listContainer.style.display = 'none';
  }
  svg.style('display', 'block');
  svg.selectAll('*').remove();

  const { width: viewWidth, height: viewHeight } = getSvgSize();
  const margin = { top: 50, right: 40, bottom: 120, left: 60 };
  const chartWidth = viewWidth - margin.left - margin.right;
  const chartHeight = viewHeight - margin.top - margin.bottom;

  const genreCounts = new Map();
  data.movies.forEach((movie) => {
    (movie.genres ?? []).forEach((genre) => {
      genreCounts.set(genre.name, (genreCounts.get(genre.name) ?? 0) + 1);
    });
  });

  const dataset = Array.from(genreCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const x = d3
    .scaleBand()
    .domain(dataset.map((d) => d.name))
    .range([0, chartWidth])
    .padding(0.2);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(dataset, (d) => d.count) ?? 1])
    .nice()
    .range([chartHeight, 0]);

  const chart = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  chart
    .append('text')
    .attr('x', 0)
    .attr('y', -20)
    .attr('fill', '#e2e8f0')
    .attr('font-size', 16)
    .text('Genre-Haeufigkeit');

  chart
    .selectAll('rect')
    .data(dataset)
    .enter()
    .append('rect')
    .attr('x', (d) => x(d.name))
    .attr('y', (d) => y(d.count))
    .attr('width', x.bandwidth())
    .attr('height', (d) => chartHeight - y(d.count))
    .attr('fill', '#38bdf8');

  const xAxis = chart
    .append('g')
    .attr('transform', `translate(0,${chartHeight})`)
    .call(d3.axisBottom(x));

  xAxis
    .selectAll('text')
    .attr('text-anchor', 'end')
    .attr('transform', 'rotate(-35)')
    .attr('dx', '-0.6em')
    .attr('dy', '0.25em');
  styleAxis(xAxis);

  const yAxis = chart.append('g').call(d3.axisLeft(y).ticks(6));
  styleAxis(yAxis);

  chart
    .append('text')
    .attr('x', chartWidth / 2)
    .attr('y', chartHeight + 90)
    .attr('text-anchor', 'middle')
    .attr('fill', '#cbd5f5')
    .attr('font-size', 12)
    .text('Genre');

  chart
    .append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -chartHeight / 2)
    .attr('y', -45)
    .attr('text-anchor', 'middle')
    .attr('fill', '#cbd5f5')
    .attr('font-size', 12)
    .text('Anzahl Filme');
};

const renderReleaseRuntimeScatter = (data) => {
  if (listContainer) {
    listContainer.style.display = 'none';
  }
  svg.style('display', 'block');
  svg.selectAll('*').remove();

  const { width: viewWidth, height: viewHeight } = getSvgSize();
  const margin = { top: 50, right: 40, bottom: 60, left: 70 };
  const chartWidth = viewWidth - margin.left - margin.right;
  const chartHeight = viewHeight - margin.top - margin.bottom;

  const dataset = data.movies
    .map((movie) => {
      const year = Number(movie.release_date?.slice(0, 4));
      return { title: movie.title, year, runtime: movie.runtime };
    })
    .filter((movie) => Number.isFinite(movie.year) && movie.runtime > 0);

  const yearExtent = d3.extent(dataset, (d) => d.year);
  const runtimeMax = d3.max(dataset, (d) => d.runtime) ?? 1;

  const x = d3
    .scaleLinear()
    .domain(yearExtent[0] ? yearExtent : [2000, 2030])
    .nice()
    .range([0, chartWidth]);
  const y = d3.scaleLinear().domain([0, runtimeMax]).nice().range([chartHeight, 0]);

  const chart = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  chart
    .append('text')
    .attr('x', 0)
    .attr('y', -20)
    .attr('fill', '#e2e8f0')
    .attr('font-size', 16)
    .text('Release-Jahr vs. Runtime');

  chart
    .selectAll('circle')
    .data(dataset)
    .enter()
    .append('circle')
    .attr('cx', (d) => x(d.year))
    .attr('cy', (d) => y(d.runtime))
    .attr('r', 4)
    .attr('fill', '#22c55e')
    .attr('opacity', 0.8);

  const xAxis = chart
    .append('g')
    .attr('transform', `translate(0,${chartHeight})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format('d')));
  styleAxis(xAxis);

  const yAxis = chart.append('g').call(d3.axisLeft(y).ticks(6));
  styleAxis(yAxis);

  chart
    .append('text')
    .attr('x', chartWidth / 2)
    .attr('y', chartHeight + 45)
    .attr('text-anchor', 'middle')
    .attr('fill', '#cbd5f5')
    .attr('font-size', 12)
    .text('Release-Jahr');

  chart
    .append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -chartHeight / 2)
    .attr('y', -50)
    .attr('text-anchor', 'middle')
    .attr('fill', '#cbd5f5')
    .attr('font-size', 12)
    .text('Runtime (Minuten)');
};

const renderChart = (data) => {
  const mode = chartSelect?.value ?? 'list';
  if (layoutModeInput?.parentElement) {
    layoutModeInput.parentElement.style.display = mode === 'force' ? '' : 'none';
  }
  if (mode !== 'force') {
    currentLayoutModeUpdater = null;
  }
  if (mode === 'genres') {
    renderGenresBar(data);
    return;
  }
  if (mode === 'scatter') {
    renderReleaseRuntimeScatter(data);
    return;
  }
  if (mode === 'force') {
    if (listContainer) {
      listContainer.style.display = 'none';
    }
    const graph = createMovieGraph(data);
    renderNetwork(graph);
    return;
  }
  renderList(data);
};

if (chartSelect) {
  chartSelect.addEventListener('change', () => {
    if (currentData) {
      renderChart(currentData);
    }
  });
}

const loadData = async () => {
  const sources = ['../data/movies.json', '../data/movies.sample.json'];

  for (const source of sources) {
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error('Request failed');
      return response.json();
    } catch (error) {
      console.warn(`Unable to load ${source}`, error);
    }
  }

  throw new Error('No data available');
};

const loadFromFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

loadData()
  .then((data) => {
    updateInfo(data);
    currentData = data;
    renderChart(data);
  })
  .catch((error) => {
    datasetInfo.textContent =
      'Keine Daten verfügbar. Bitte JSON-Datei auswählen oder den TMDB-Download ausführen.';
    console.error(error);
  });

jsonFileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = await loadFromFile(file);
    updateInfo(data);
    currentData = data;
    renderChart(data);
  } catch (error) {
    datasetInfo.textContent = 'Konnte JSON nicht laden. Bitte Datei prüfen.';
    console.error(error);
  }
});
